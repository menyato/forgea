import { Injectable } from '@nestjs/common';
import type { SaveFreeOfferDto } from '@forgea/validation';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { OrderStatus } from '../generated/prisma/enums.js';

const WITH_PRODUCT = {
  product: { select: { name: true, slug: true, active: true } },
} as const;

export type OfferRow = Prisma.FreeOfferGetPayload<{
  include: typeof WITH_PRODUCT;
}>;

/** Claims are the offer's order lines on orders that weren't cancelled. */
const CLAIMED = { order: { status: { not: OrderStatus.CANCELLED } } } as const;

@Injectable()
export class OffersRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<OfferRow[]> {
    return this.prisma.freeOffer.findMany({
      include: WITH_PRODUCT,
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  find(
    id: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<OfferRow | null> {
    return tx.freeOffer.findUnique({ where: { id }, include: WITH_PRODUCT });
  }

  /** Offers switched on and running at `now`, the one ending first first. */
  running(now: Date): Promise<OfferRow[]> {
    return this.prisma.freeOffer.findMany({
      where: { active: true, startsAt: { lte: now }, endsAt: { gt: now } },
      include: WITH_PRODUCT,
      orderBy: { endsAt: 'asc' },
    });
  }

  /** How many each offer gave so far (orders not cancelled). */
  async claimed(ids: readonly string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.orderItem.groupBy({
      by: ['freeOfferId'],
      where: { freeOfferId: { in: [...ids] }, ...CLAIMED },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.freeOfferId!, r._count._all]));
  }

  /** As `claimed` for one offer, inside a transaction; and whether `userId` has one. */
  async claimsIn(
    tx: Prisma.TransactionClient,
    offerId: string,
    userId: string,
  ): Promise<{ total: number; theirs: number }> {
    const [total, theirs] = await Promise.all([
      tx.orderItem.count({ where: { freeOfferId: offerId, ...CLAIMED } }),
      tx.orderItem.count({
        where: {
          freeOfferId: offerId,
          order: { ...CLAIMED.order, userId },
        },
      }),
    ]);
    return { total, theirs };
  }

  create(dto: SaveFreeOfferDto): Promise<OfferRow> {
    return this.prisma.freeOffer.create({
      data: fields(dto),
      include: WITH_PRODUCT,
    });
  }

  update(id: string, dto: SaveFreeOfferDto): Promise<OfferRow> {
    return this.prisma.freeOffer.update({
      where: { id },
      data: fields(dto),
      include: WITH_PRODUCT,
    });
  }
}

const fields = (dto: SaveFreeOfferDto) => ({
  productId: dto.productId,
  title: dto.title,
  description: dto.description || null,
  startsAt: dto.startsAt,
  endsAt: dto.endsAt,
  maxClaims: dto.maxClaims ?? null,
  active: dto.active,
});
