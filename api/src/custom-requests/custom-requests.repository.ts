import { Injectable } from '@nestjs/common';
import type {
  CursorPageQuery,
  CustomRequestListQuery,
} from '@forgea/validation';
import { keysetPage } from '../common/pagination/keyset.js';
import { setStatusActor } from '../common/status-actor.js';
import { PrismaService } from '../database/prisma.service.js';
import { type Material, Prisma } from '../generated/prisma/client.js';
import { CustomRequestStatus } from '../generated/prisma/enums.js';
import { generateRequestNumber } from '../orders/order-number.js';

const withDetail = {
  user: { select: { email: true, name: true, phone: true } },
  material: { select: { id: true, code: true, name: true } },
  order: { select: { orderNumber: true } },
  statusHistory: {
    orderBy: { changedAt: 'asc' },
    select: { status: true, changedAt: true, note: true },
  },
} as const satisfies Prisma.CustomRequestInclude;
export type RequestRow = Prisma.CustomRequestGetPayload<{
  include: typeof withDetail;
}>;

export interface NewRequest {
  userId: string;
  title: string;
  description: string;
  quantity: number;
  materialId: string | null;
  colour: string | null;
  fileKey: string | null;
  estimate: { low: string; high: string } | null;
}

/** Number of fresh request numbers to try if one collides (≈ never at 50 bits). */
const NUMBER_ATTEMPTS = 3;

@Injectable()
export class CustomRequestsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The first history row is written by the database trigger, with the customer as actor. */
  async create(r: NewRequest): Promise<RequestRow> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await setStatusActor(tx, r.userId, null);
          return tx.customRequest.create({
            data: {
              requestNumber: generateRequestNumber(),
              userId: r.userId,
              title: r.title,
              description: r.description,
              quantity: r.quantity,
              materialId: r.materialId,
              colour: r.colour,
              fileKey: r.fileKey,
              estimateLow: r.estimate?.low ?? null,
              estimateHigh: r.estimate?.high ?? null,
            },
            include: withDetail,
          });
        });
      } catch (error) {
        const collided =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002';
        if (!collided || attempt >= NUMBER_ATTEMPTS) throw error;
      }
    }
  }

  findById(id: string): Promise<RequestRow | null> {
    return this.prisma.customRequest.findUnique({
      where: { id },
      include: withDetail,
    });
  }

  /** Only the owner's own request; anyone else's number finds nothing. */
  findMine(userId: string, requestNumber: string): Promise<RequestRow | null> {
    return this.prisma.customRequest.findFirst({
      where: { userId, requestNumber },
      include: withDetail,
    });
  }

  listMine(userId: string, query: CursorPageQuery) {
    return this.page(query, { userId });
  }

  /** The dashboard inbox. */
  list(query: CustomRequestListQuery) {
    const q = query.q?.trim();
    return this.page(query, {
      ...(query.status ? { status: query.status } : {}),
      ...(q
        ? {
            OR: [
              { requestNumber: { contains: q.toUpperCase() } },
              { title: { contains: q, mode: 'insensitive' } },
              { user: { email: { contains: q.toLowerCase() } } },
            ],
          }
        : {}),
    });
  }

  /**
   * Sends (or replaces) the studio's quote. Only a request still open — waiting for a quote,
   * or quoted and unanswered — can be quoted; false when it moved on meanwhile.
   */
  quote(
    id: string,
    actorId: string,
    q: { price: string; note: string | null; expiresAt: Date },
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await setStatusActor(tx, actorId, q.note);
      const { count } = await tx.customRequest.updateMany({
        where: {
          id,
          status: {
            in: [CustomRequestStatus.SUBMITTED, CustomRequestStatus.QUOTED],
          },
        },
        data: {
          status: CustomRequestStatus.QUOTED,
          quotedPrice: q.price,
          quoteNote: q.note,
          quotedAt: new Date(),
          quoteExpiresAt: q.expiresAt,
          quotedByUserId: actorId,
        },
      });
      return count === 1;
    });
  }

  /** Sets the design preview; false when the request is no longer open. */
  async setDesignPreview(id: string, key: string): Promise<boolean> {
    const { count } = await this.prisma.customRequest.updateMany({
      where: {
        id,
        status: {
          in: [CustomRequestStatus.SUBMITTED, CustomRequestStatus.QUOTED],
        },
      },
      data: { designPreviewKey: key },
    });
    return count === 1;
  }

  /**
   * Closes a request (declined or cancelled) if it is still in one of `from`. The trigger
   * records who closed it and the note. False when its status changed meanwhile.
   */
  close(
    id: string,
    from: CustomRequestStatus[],
    to: CustomRequestStatus,
    actorId: string,
    note: string | null,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await setStatusActor(tx, actorId, note);
      const { count } = await tx.customRequest.updateMany({
        where: { id, status: { in: from } },
        data: { status: to },
      });
      return count === 1;
    });
  }

  activeMaterials() {
    return this.prisma.material.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true },
    });
  }

  /** The material for an estimate: the one chosen, or the cheapest one in use. */
  materialFor(materialId: string | null): Promise<Material | null> {
    return this.prisma.material.findFirst({
      where: { active: true, ...(materialId ? { id: materialId } : {}) },
      orderBy: { pricePerGram: 'asc' },
    });
  }

  private page(query: CursorPageQuery, where: Prisma.CustomRequestWhereInput) {
    return keysetPage<RequestRow>(
      {
        sortField: 'createdAt',
        kind: 'date',
        order: query.order,
        limit: query.limit,
        cursor: query.cursor,
        valueOf: (row) => row.createdAt,
      },
      ({ after, orderBy, take }) =>
        this.prisma.customRequest.findMany({
          where: { AND: [where, after as Prisma.CustomRequestWhereInput] },
          orderBy: orderBy as Prisma.CustomRequestOrderByWithRelationInput[],
          take,
          include: withDetail,
        }),
    );
  }
}
