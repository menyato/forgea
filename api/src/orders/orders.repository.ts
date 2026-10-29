import { Injectable } from '@nestjs/common';
import type { OrderQuote } from '@forgea/pricing';
import type { ChosenOption } from '@forgea/types';
import type {
  CheckoutDto,
  MyOrdersQuery,
  OrderListQuery,
} from '@forgea/validation';
import { dateRange } from '../common/pagination/date-range.js';
import { keysetPage } from '../common/pagination/keyset.js';
import { setStatusActor } from '../common/status-actor.js';
import { PrismaService } from '../database/prisma.service.js';
import { type Order, Prisma } from '../generated/prisma/client.js';
import {
  CustomRequestStatus,
  type OrderStatus,
  QuotationStatus,
} from '../generated/prisma/enums.js';
import { generateOrderNumber } from './order-number.js';

const withCustomer = {
  user: { select: { email: true } },
} as const satisfies Prisma.OrderInclude;
type OrderRow = Prisma.OrderGetPayload<{ include: typeof withCustomer }>;

const withCustomerView = {
  user: { select: { email: true } },
  items: { select: { name: true, quantity: true, lineTotal: true } },
  statusHistory: {
    orderBy: { changedAt: 'asc' },
    select: { status: true, changedAt: true, note: true },
  },
} as const satisfies Prisma.OrderInclude;
export type CustomerOrderRow = Prisma.OrderGetPayload<{
  include: typeof withCustomerView;
}>;

const withStaffView = {
  user: { select: { email: true } },
  items: { include: { product: { select: { slug: true } } } },
  statusHistory: {
    orderBy: { changedAt: 'asc' },
    include: { changedBy: { select: { email: true } } },
  },
  customRequest: { select: { requestNumber: true } },
} as const satisfies Prisma.OrderInclude;
export type StaffOrderRow = Prisma.OrderGetPayload<{
  include: typeof withStaffView;
}>;

/** Where a quoted line came from: a cart line (product + options) or a custom request. */
export interface OrderLineSource {
  id: string;
  productId: string | null;
  options: readonly ChosenOption[];
}

export interface NewOrder {
  /** The cart emptied by this order; null for an order made from a custom request's quote. */
  cartId: string | null;
  userId: string;
  /** Who placed it, when not the customer (staff confirming a quotation). */
  actorId?: string;
  status: OrderStatus;
  dto: CheckoutDto;
  /** Rush as priced (the form's choice at checkout; never for an accepted quote). */
  rush: boolean;
  quote: OrderQuote;
  /** What the quote was made from (matched by line id): product and options. */
  lines: readonly OrderLineSource[];
  currency: { code: string; rate: string; total: string; deposit: string };
  /**
   * Where the order comes from, closed in the same transaction: a custom request's quote
   * (QUOTED → ACCEPTED) or a quotation (from one of its openStatuses → CONFIRMED: staff may
   * confirm a draft, a customer only a quotation that was sent to them).
   */
  source?:
    | { customRequestId: string; quotedPrice: string }
    | { quotationId: string; openStatuses: QuotationStatus[] };
}

/** The quote being accepted expired or was answered meanwhile; nothing was created. */
export class QuoteNoLongerOpenError extends Error {
  constructor() {
    super('This quote can no longer be accepted');
  }
}

/** Number of fresh order numbers to try if one collides (≈ never at 50 bits). */
const ORDER_NUMBER_ATTEMPTS = 3;

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByIdempotencyKey(idempotencyKey: string): Promise<Order | null> {
    return this.prisma.order.findUnique({ where: { idempotencyKey } });
  }

  /**
   * Creates the order, its items and its first status-history row, and deletes the cart —
   * all in one transaction, so a failure leaves the cart untouched and no half-made order.
   */
  async createFromCheckout(o: NewOrder): Promise<Order> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          // The first history row is written by the database trigger; tell it who acted.
          await setStatusActor(tx, o.actorId ?? o.userId, null);
          const order = await tx.order.create({
            data: {
              orderNumber: generateOrderNumber(),
              idempotencyKey: o.dto.idempotencyKey,
              userId: o.userId,
              status: o.status,
              paymentMethod: o.dto.paymentMethod,
              customerName: o.dto.name,
              phone: o.dto.phone,
              delivery: o.dto.delivery,
              rush: o.rush,
              city: o.dto.delivery ? (o.dto.city ?? null) : null,
              addressLine: o.dto.delivery ? (o.dto.addressLine ?? null) : null,
              deliveryNotes: o.dto.deliveryNotes ?? null,
              subtotal: o.quote.summary[0]?.amount ?? o.quote.total,
              deliveryFee:
                o.quote.summary.find((l) => l.kind === 'delivery-fee')
                  ?.amount ?? '0',
              total: o.quote.total,
              priceBreakdown: o.quote
                .summary as unknown as Prisma.InputJsonValue,
              depositRequired: o.quote.depositRequired,
              currencyCode: o.currency.code,
              exchangeRate: o.currency.rate,
              totalInCurrency: o.currency.total,
              depositInCurrency: o.currency.deposit,
              items: {
                create: o.quote.lines.map((l) => ({
                  productId: lineOf(o, l.id).productId,
                  options: lineOf(o, l.id)
                    .options as unknown as Prisma.InputJsonValue,
                  name: l.name,
                  quantity: l.quantity,
                  unitPrice: l.unitPrice,
                  lineTotal: l.lineTotal,
                  isCustom: l.isCustom,
                })),
              },
            },
          });
          if (o.cartId) await tx.cart.deleteMany({ where: { id: o.cartId } });
          if (o.source && 'customRequestId' in o.source) {
            // Only a quote still waiting for an answer can be accepted; otherwise roll back.
            const { count } = await tx.customRequest.updateMany({
              where: {
                id: o.source.customRequestId,
                status: CustomRequestStatus.QUOTED,
                quoteExpiresAt: { gt: new Date() },
                // The price the customer saw: a re-quote meanwhile makes this fail.
                quotedPrice: o.source.quotedPrice,
              },
              data: {
                status: CustomRequestStatus.ACCEPTED,
                orderId: order.id,
              },
            });
            if (count !== 1) throw new QuoteNoLongerOpenError();
          }
          if (o.source && 'quotationId' in o.source) {
            const { count } = await tx.quotation.updateMany({
              where: {
                id: o.source.quotationId,
                status: { in: o.source.openStatuses },
                validUntil: { gte: startOfToday() },
              },
              data: { status: QuotationStatus.CONFIRMED, orderId: order.id },
            });
            if (count !== 1) throw new QuoteNoLongerOpenError();
          }
          return order;
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Two submits with the same key raced: return the one that won.
        const raced = await this.findByIdempotencyKey(o.dto.idempotencyKey);
        if (raced?.userId === o.userId) return raced;
        if (raced) throw error;
        // Otherwise the random order number collided; try a fresh one.
        if (attempt >= ORDER_NUMBER_ATTEMPTS) throw error;
      }
    }
  }

  /** A customer's own orders, newest first, each with its items and full status history. */
  listForUser(userId: string, query: MyOrdersQuery) {
    return keysetPage<CustomerOrderRow>(
      {
        sortField: 'createdAt',
        kind: 'date',
        order: query.order,
        limit: query.limit,
        cursor: query.cursor,
        valueOf: (row) => row.createdAt,
      },
      ({ after, orderBy, take }) =>
        this.prisma.order.findMany({
          where: { AND: [{ userId }, after as Prisma.OrderWhereInput] },
          orderBy: orderBy as Prisma.OrderOrderByWithRelationInput[],
          take,
          include: withCustomerView,
        }),
    );
  }

  /** One order with everything the dashboard shows. */
  findForStaff(id: string): Promise<StaffOrderRow | null> {
    return this.prisma.order.findUnique({
      where: { id },
      include: withStaffView,
    });
  }

  /** Who to tell about the order, and its number. */
  async contactOf(
    id: string,
  ): Promise<{ email: string; orderNumber: string } | null> {
    const o = await this.prisma.order.findUnique({
      where: { id },
      select: { orderNumber: true, user: { select: { email: true } } },
    });
    return o ? { email: o.user.email, orderNumber: o.orderNumber } : null;
  }

  findStatus(id: string): Promise<Pick<Order, 'id' | 'status'> | null> {
    return this.prisma.order.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
  }

  /**
   * Changes the status only if it is still `from` (so two staff members can't both apply a
   * change based on a stale view). The trigger writes the history row with actor and note.
   * Returns false when someone else changed the order first.
   */
  changeStatus(
    id: string,
    from: OrderStatus,
    to: OrderStatus,
    actorUserId: string,
    note: string | null,
    extra: Prisma.OrderUpdateManyMutationInput = {},
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await setStatusActor(tx, actorUserId, note);
      const { count } = await tx.order.updateMany({
        where: { id, status: from },
        data: { status: to, ...extra },
      });
      return count === 1;
    });
  }

  /** All orders, for staff. */
  list(query: OrderListQuery) {
    const search = query.q?.toLowerCase();
    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(dateRange(query.from, query.to)
        ? { createdAt: dateRange(query.from, query.to) }
        : {}),
      ...(search
        ? {
            OR: [
              { orderNumber: { contains: query.q, mode: 'insensitive' } },
              { user: { email: { contains: search } } },
            ],
          }
        : {}),
    };
    return keysetPage<OrderRow>(
      {
        sortField: query.sort,
        kind: query.sort === 'total' ? 'decimal' : 'date',
        order: query.order,
        limit: query.limit,
        cursor: query.cursor,
        valueOf: (row) => row[query.sort],
      },
      ({ after, orderBy, take }) =>
        this.prisma.order.findMany({
          where: { AND: [where, after as Prisma.OrderWhereInput] },
          orderBy: orderBy as Prisma.OrderOrderByWithRelationInput[],
          take,
          include: withCustomer,
        }),
    );
  }
}

/** Today at 00:00 UTC: a quotation is valid through its last day. */
function startOfToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function lineOf(o: NewOrder, id: string): OrderLineSource {
  const line = o.lines.find((l) => l.id === id);
  if (!line) throw new Error(`Quoted line ${id} is not in the cart`);
  return line;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
