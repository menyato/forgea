import { Injectable } from '@nestjs/common';
import type { QuotationListQuery } from '@forgea/validation';
import { keysetPage } from '../common/pagination/keyset.js';
import { setStatusActor } from '../common/status-actor.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  QuotationStatus,
  Role,
  type PaymentMethod,
} from '../generated/prisma/enums.js';

const withDetail = {
  customer: { select: { id: true, email: true, name: true } },
  order: { select: { orderNumber: true } },
  lines: { orderBy: { sortOrder: 'asc' } },
  statusHistory: {
    orderBy: { changedAt: 'asc' },
    select: { status: true, changedAt: true, note: true },
  },
} as const satisfies Prisma.QuotationInclude;
export type QuotationRow = Prisma.QuotationGetPayload<{
  include: typeof withDetail;
}>;

export interface QuotationData {
  /** Their account if the address has one; the quotation is emailed either way. */
  customerId: string | null;
  customerEmail: string;
  leadId: string | null;
  validUntil: Date;
  note: string | null;
  customerName: string;
  phone: string;
  paymentMethod: PaymentMethod;
  delivery: boolean;
  city: string | null;
  addressLine: string | null;
  total: string;
  lines: {
    productId: string | null;
    description: string;
    quantity: number;
    unitPrice: string;
    discountPercent: string;
    isCustom: boolean;
    sizeXcm: string | null;
    sizeYcm: string | null;
    sizeZcm: string | null;
  }[];
}

const NUMBER_ATTEMPTS = 5;

@Injectable()
export class QuotationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Numbered "Q-<year>-0001" onwards; the trigger writes the first history row. */
  async create(q: QuotationData, actorId: string): Promise<QuotationRow> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await setStatusActor(tx, actorId, null);
          return tx.quotation.create({
            data: {
              ...q,
              number: await this.nextNumber(tx),
              createdById: actorId,
              lines: {
                create: q.lines.map((l, i) => ({ ...l, sortOrder: i })),
              },
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

  private async nextNumber(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getUTCFullYear();
    const last = await tx.quotation.findFirst({
      where: { number: { startsWith: `Q-${year}-` } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const next = last ? Number(last.number.slice(7)) + 1 : 1;
    return `Q-${year}-${String(next).padStart(4, '0')}`;
  }

  /** Replaces everything but the number while it is a draft or sent; false otherwise. */
  async update(id: string, q: QuotationData): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.quotation.updateMany({
        where: {
          id,
          status: { in: [QuotationStatus.DRAFT, QuotationStatus.SENT] },
        },
        data: {
          customerId: q.customerId,
          customerEmail: q.customerEmail,
          leadId: q.leadId,
          validUntil: q.validUntil,
          note: q.note,
          customerName: q.customerName,
          phone: q.phone,
          paymentMethod: q.paymentMethod,
          delivery: q.delivery,
          city: q.city,
          addressLine: q.addressLine,
          total: q.total,
        },
      });
      if (count !== 1) return false;
      await tx.quotationLine.deleteMany({ where: { quotationId: id } });
      await tx.quotationLine.createMany({
        data: q.lines.map((l, i) => ({ ...l, quotationId: id, sortOrder: i })),
      });
      return true;
    });
  }

  findById(id: string): Promise<QuotationRow | null> {
    return this.prisma.quotation.findUnique({
      where: { id },
      include: withDetail,
    });
  }

  /** Only the customer's own quotation; anyone else's number finds nothing. */
  findMine(customerId: string, number: string): Promise<QuotationRow | null> {
    return this.prisma.quotation.findFirst({
      where: { customerId, number },
      include: withDetail,
    });
  }

  /** A status change only from the expected statuses; the trigger records it. */
  setStatus(
    id: string,
    from: QuotationStatus[],
    to: QuotationStatus,
    actorId: string,
    note: string | null,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await setStatusActor(tx, actorId, note);
      const { count } = await tx.quotation.updateMany({
        where: { id, status: { in: from } },
        data: {
          status: to,
          ...(to === QuotationStatus.SENT ? { sentAt: new Date() } : {}),
        },
      });
      return count === 1;
    });
  }

  /** How many in each status: the numbers on the dashboard's tabs. */
  async countByStatus(): Promise<Partial<Record<QuotationStatus, number>>> {
    const rows = await this.prisma.quotation.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }

  list(query: QuotationListQuery) {
    const q = query.q?.trim();
    const where: Prisma.QuotationWhereInput = {
      ...(query.statuses?.length
        ? { status: { in: query.statuses } }
        : query.status
          ? { status: query.status }
          : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q.toUpperCase() } },
              { customerEmail: { contains: q.toLowerCase() } },
              { customerName: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return keysetPage<QuotationRow>(
      {
        sortField: query.sort,
        kind: query.sort === 'number' ? 'string' : 'date',
        order: query.order,
        limit: query.limit,
        cursor: query.cursor,
        valueOf: (row) => row[query.sort],
      },
      ({ after, orderBy, take }) =>
        this.prisma.quotation.findMany({
          where: { AND: [where, after as Prisma.QuotationWhereInput] },
          orderBy: orderBy as Prisma.QuotationOrderByWithRelationInput[],
          take,
          include: withDetail,
        }),
    );
  }

  /**
   * Ties a quotation sent to an address without an account to the account that now accepts
   * it with that address. Only while it has none: never moves someone else's quotation.
   */
  async linkCustomer(id: string, customerId: string): Promise<boolean> {
    const { count } = await this.prisma.quotation.updateMany({
      where: { id, customerId: null },
      data: { customerId },
    });
    return count === 1;
  }

  /**
   * Staff confirm a quotation for someone without an account (they said yes on the phone):
   * the order needs one, so a customer account is made for the address, with no password.
   * Its owner sets one with "forgot your password", which proves the address.
   */
  createCustomer(email: string, name: string, phone: string) {
    return this.prisma.user.create({
      data: { email, name, phone, role: Role.CUSTOMER },
      select: { id: true },
    });
  }

  account(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, disabledAt: true },
    });
  }

  customerByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, role: true, disabledAt: true },
    });
  }

  productsExist(ids: string[]): Promise<number> {
    return this.prisma.product.count({ where: { id: { in: ids } } });
  }

  leadExists(id: string): Promise<boolean> {
    return this.prisma.lead.count({ where: { id } }).then((n) => n === 1);
  }
}
