import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ChosenOption,
  CustomerOrder,
  InvoiceListItem,
  Page,
} from '@forgea/types';
import type { MyOrdersQuery } from '@forgea/validation';
import { Invoicing } from '../accounting/invoicing.service.js';
import { OrderStatus } from '../generated/prisma/enums.js';
import type { Measurement } from '../text-studio/text-studio.service.js';
import { OrderStatusService } from './order-status.service.js';
import {
  OrdersRepository,
  type CustomerOrderRow,
} from './orders.repository.js';
import type { OrderedSlot } from '../text-studio/design-slots.js';

/** Before the studio has started on it (and no deposit came in), the customer may cancel. */
const CUSTOMER_CANCELLABLE: readonly OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.AWAITING_DEPOSIT,
];

/** Orders as their customers see them ("My Orders"), and what they may do with them. */
@Injectable()
export class CustomerOrdersService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly invoicing: Invoicing,
    private readonly statuses: OrderStatusService,
  ) {}

  async mine(
    userId: string,
    query: MyOrdersQuery,
  ): Promise<Page<CustomerOrder>> {
    const page = await this.orders.listForUser(userId, query);
    // One query for the whole page's invoices, not one per order.
    const invoices = await this.invoicing.forOrders(page.rows.map((o) => o.id));
    return {
      items: page.rows.map((o) => toCustomerOrder(o, invoices.get(o.id) ?? [])),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  /**
   * The customer changed their mind before the studio started: cancelled through the same
   * status change as the team's (history written, email sent), and the studio is told.
   */
  async cancel(userId: string, orderNumber: string): Promise<void> {
    const order = await this.orders.findOwn(userId, orderNumber);
    if (!order) throw new NotFoundException('Order not found');
    if (!CUSTOMER_CANCELLABLE.includes(order.status) || order.depositPaid) {
      throw new ConflictException(
        'This order is already being prepared. Message us on WhatsApp to change it.',
      );
    }
    await this.statuses.change(
      order.id,
      OrderStatus.CANCELLED,
      userId,
      'Cancelled by the customer',
      { expected: order.status, unpaidOnly: true },
    );
  }
}

const KIND = {
  DEPOSIT: 'deposit',
  FINAL: 'final',
} as const;

/** No address, phone or internal ids: only what the customer needs to follow the order. */
function toCustomerOrder(
  o: CustomerOrderRow,
  invoices: InvoiceListItem[],
): CustomerOrder {
  return {
    orderNumber: o.orderNumber,
    status: o.status,
    paymentMethod: o.paymentMethod,
    delivery: o.delivery,
    total: o.total.toFixed(2),
    depositRequired: o.depositRequired.toFixed(2),
    depositPaid: o.depositPaid,
    currencyCode: o.currencyCode,
    totalInCurrency: o.totalInCurrency.toString(),
    items: o.items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      lineTotal: i.lineTotal.toFixed(2),
      // A snapshot written at checkout: [{ group, value }].
      options: i.options as unknown as ChosenOption[],
      design: (i.design as Measurement | null)?.summary ?? null,
      slots: ((i.slots as OrderedSlot[] | null) ?? []).map((s) => s.summary),
    })),
    history: o.statusHistory.map((h) => ({
      status: h.status,
      changedAt: h.changedAt.toISOString(),
      note: h.note,
    })),
    invoices: invoices.map((i) => ({
      number: i.number,
      kind:
        i.type === 'CREDIT_NOTE'
          ? 'credit note'
          : i.invoiceKind
            ? KIND[i.invoiceKind]
            : 'final',
      date: i.date,
      total: i.total,
      residual: i.residual,
      paid: i.paymentState === 'paid' || i.paymentState === 'reversed',
    })),
    canCancel: CUSTOMER_CANCELLABLE.includes(o.status) && !o.depositPaid,
    createdAt: o.createdAt.toISOString(),
  };
}
