import { ConflictException, Injectable } from '@nestjs/common';
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
import { catchUpOrderSequences, nextOrderNumber } from './order-number.js';
import { studioToday } from '../common/studio-day.js';

/** How many of an order's lines its row in the staff's list names. */
const LIST_ITEMS_SHOWN = 3;

const withCustomer = {
  user: { select: { email: true } },
} as const satisfies Prisma.OrderInclude;
/** A row of the staff's list: who, and the first few things ordered with how many there are. */
const withListView = {
  ...withCustomer,
  items: {
    select: { name: true, quantity: true },
    orderBy: { id: 'asc' },
    take: LIST_ITEMS_SHOWN,
  },
  _count: { select: { items: true } },
} as const satisfies Prisma.OrderInclude;
type OrderListRow = Prisma.OrderGetPayload<{
  include: typeof withListView;
}>;

const withCustomerView = {
  user: { select: { email: true } },
  items: {
    select: {
      name: true,
      quantity: true,
      lineTotal: true,
      options: true,
      design: true,
    },
    orderBy: { id: 'asc' },
  },
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
  items: {
    include: {
      product: {
        select: {
          slug: true,
          modelFileKey: true,
          printFiles: {
            select: { id: true, name: true },
            orderBy: { sortOrder: 'asc' },
          },
        },
      },
    },
  },
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
  /** A personalised piece: the design as made and priced (TextStudio Measurement). */
  design?: object | null;
  /** Made from a 3MF: the file and what one unit of the line takes (PrintFile). */
  printFile?: object | null;
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
    | {
        quotationId: string;
        openStatuses: QuotationStatus[];
        /** As read: an edit meanwhile (new prices) refuses the confirmation. */
        updatedAt: Date;
      };
}

/** The quote being accepted expired or was answered meanwhile; nothing was created. */
export class QuoteNoLongerOpenError extends Error {
  constructor() {
    super('This quote can no longer be accepted');
  }
}

/** Tries before giving up when the order number is taken (the counter is caught up between). */
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
              orderNumber: await nextOrderNumber(tx),
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
                  ...(lineOf(o, l.id).design
                    ? {
                        design: lineOf(o, l.id).design as Prisma.InputJsonValue,
                      }
                    : {}),
                  ...(lineOf(o, l.id).printFile
                    ? {
                        printFile: lineOf(o, l.id)
                          .printFile as Prisma.InputJsonValue,
                      }
                    : {}),
                  name: l.name,
                  quantity: l.quantity,
                  unitPrice: l.unitPrice,
                  lineTotal: l.lineTotal,
                  isCustom: l.isCustom,
                })),
              },
            },
          });
          if (o.cartId) {
            // The cart must still be the one priced: two tabs ordering it, or an item added or
            // changed meanwhile, refuse this order instead of making a second or a wrong one.
            const now = await tx.cartItem.findMany({
              where: { cartId: o.cartId },
              select: { id: true, quantity: true },
            });
            const priced = new Map(
              o.quote.lines.map((l) => [l.id, l.quantity]),
            );
            const { count } = await tx.cart.deleteMany({
              where: { id: o.cartId },
            });
            if (
              count !== 1 ||
              now.length !== priced.size ||
              now.some((i) => priced.get(i.id) !== i.quantity)
            )
              throw new ConflictException(
                'Your cart changed meanwhile (another tab?). Check it and order again.',
              );
          }
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
                updatedAt: o.source.updatedAt,
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
        // Otherwise the order number was taken: the year's counter is behind the orders
        // (a restored backup). Catch it up and try again.
        if (attempt >= ORDER_NUMBER_ATTEMPTS) throw error;
        await catchUpOrderSequences(this.prisma);
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
  ): Promise<{ email: string; phone: string; orderNumber: string } | null> {
    const o = await this.prisma.order.findUnique({
      where: { id },
      select: {
        orderNumber: true,
        phone: true,
        user: { select: { email: true } },
      },
    });
    return o
      ? { email: o.user.email, phone: o.phone, orderNumber: o.orderNumber }
      : null;
  }

  findStatus(
    id: string,
  ): Promise<Pick<Order, 'id' | 'status' | 'orderNumber'> | null> {
    return this.prisma.order.findUnique({
      where: { id },
      select: { id: true, status: true, orderNumber: true },
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
    /** What must change with the status (stock taken for production), in the same transaction. */
    alongside?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await setStatusActor(tx, actorUserId, note);
      const { count } = await tx.order.updateMany({
        where: { id, status: from },
        data: { status: to, ...extra },
      });
      if (count === 1 && alongside) await alongside(tx);
      return count === 1;
    });
  }

  /** How many in each status: the numbers on the dashboard's tabs. */
  async countByStatus(): Promise<Partial<Record<OrderStatus, number>>> {
    const rows = await this.prisma.order.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }

  /** One of the customer's own orders by number; anyone else's finds nothing. */
  findOwn(userId: string, orderNumber: string) {
    return this.prisma.order.findFirst({
      where: { userId, orderNumber },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        depositPaid: true,
        items: {
          select: {
            productId: true,
            name: true,
            quantity: true,
            options: true,
            design: true,
          },
        },
      },
    });
  }

  /** All orders, for staff. */
  list(query: OrderListQuery) {
    const search = query.q?.toLowerCase();
    const where: Prisma.OrderWhereInput = {
      ...(query.statuses?.length
        ? { status: { in: query.statuses } }
        : query.status
          ? { status: query.status }
          : {}),
      ...(dateRange(query.from, query.to)
        ? { createdAt: dateRange(query.from, query.to) }
        : {}),
      ...(search
        ? {
            OR: [
              { orderNumber: { contains: query.q, mode: 'insensitive' } },
              { user: { email: { contains: search } } },
              { customerName: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return keysetPage<OrderListRow>(
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
          include: withListView,
        }),
    );
  }
}

/** The studio's day (Beirut): a quotation valid until today can still be confirmed today. */
const startOfToday = (): Date => studioToday();

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
