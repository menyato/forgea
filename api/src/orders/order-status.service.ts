import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  canChangeOrderStatus,
  ORDER_STATUS_FLOW,
  ORDER_STATUS_LABELS,
} from '@forgea/types';
import { QuotationStatus, OrderStatus } from '../generated/prisma/enums.js';
import { Invoicing } from '../accounting/invoicing.service.js';
import { Notifications } from '../mail/notifications.service.js';
import { PrintJobsService } from '../print-jobs/print-jobs.service.js';
import { OrderStock } from '../stock/order-stock.service.js';
import { OrdersRepository } from './orders.repository.js';

export interface StatusChange {
  id: string;
  status: OrderStatus;
  previousStatus: OrderStatus;
}

/**
 * The only code that changes an order's status. It enforces the shared status flow; the
 * database trigger records every change in OrderStatusHistory with the actor and note.
 */
@Injectable()
export class OrderStatusService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly notifications: Notifications,
    private readonly invoicing: Invoicing,
    private readonly stock: OrderStock,
    private readonly printJobs: PrintJobsService,
  ) {}

  async change(
    orderId: string,
    to: OrderStatus,
    actorUserId: string,
    note: string | undefined,
    guard: {
      /** The status the person saw: refused if it changed since (a stale page). */
      expected?: OrderStatus | undefined;
      /** A customer's cancel: refused once the deposit is paid, even a moment ago. */
      unpaidOnly?: boolean;
    } = {},
  ): Promise<StatusChange> {
    const order = await this.orders.findStatus(orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (guard.expected && guard.expected !== order.status)
      throw new ConflictException(
        'Someone else just changed this order. Reload and try again.',
      );
    if (!canChangeOrderStatus(order.status, to)) {
      const allowed = ORDER_STATUS_FLOW[order.status];
      throw new BadRequestException(
        allowed.length
          ? `An order that is ${order.status} can only become: ${allowed.join(', ')}`
          : `An order that is ${order.status} can't change any more`,
      );
    }
    // Confirming a custom order that was waiting for its deposit means the deposit arrived.
    const extra =
      order.status === OrderStatus.AWAITING_DEPOSIT &&
      to === OrderStatus.CONFIRMED
        ? { depositPaid: true }
        : {};

    // Going into production takes the order's filament out of stock, with the status change.
    const stock =
      to === OrderStatus.IN_PRODUCTION
        ? await this.stock.plan(orderId, actorUserId)
        : null;
    const changed = await this.orders.changeStatus(
      orderId,
      order.status,
      to,
      actorUserId,
      note ?? null,
      extra,
      async (tx) => {
        // The row is locked by now: a payment recorded meanwhile is seen here.
        if (guard.unpaidOnly) {
          const now = await tx.order.findUniqueOrThrow({
            where: { id: orderId },
            select: { depositPaid: true },
          });
          if (now.depositPaid)
            throw new ConflictException(
              'This order is already being prepared. Message us on WhatsApp to change it.',
            );
        }
        if (stock) await this.stock.apply(tx, stock);
        // A sales order from a quotation: cancelling it cancels the quotation (its history
        // records who and why, like the order's).
        if (to === OrderStatus.CANCELLED) {
          await tx.quotation.updateMany({
            where: { orderId, status: QuotationStatus.CONFIRMED },
            data: { status: QuotationStatus.CANCELLED },
          });
          // Its print runs not started stop, and the filament nobody printed comes back.
          await this.stock.cancel(tx, orderId, order.orderNumber, actorUserId);
        }
      },
    );
    if (!changed)
      throw new ConflictException(
        'Someone else just changed this order. Reload and try again.',
      );
    // The invoices and payments that follow (deposit received, delivered); never blocks this.
    // Going into production: a print job for each line (never blocks the change).
    if (to === OrderStatus.IN_PRODUCTION)
      await this.printJobs.createForOrder(orderId);
    // Cancelled runs come off the studio's calendar (never blocks).
    if (to === OrderStatus.CANCELLED)
      await this.printJobs.unscheduleCancelled(orderId);
    await this.invoicing.onOrderStatus(orderId, order.status, to, actorUserId);
    const contact = await this.orders.contactOf(orderId);
    if (contact) {
      this.notifications.send('orderStatus', {
        to: contact.email,
        orderNumber: contact.orderNumber,
        status: to,
        note: note ?? null,
      });
      this.notifications.whatsapp(contact.phone, {
        about: `Order ${contact.orderNumber}`,
        update: `${ORDER_STATUS_LABELS[to].title}. ${ORDER_STATUS_LABELS[to].detail}${note ? ` ${note}` : ''}`,
        path: '/orders',
      });
      // Both sides hear of every step: the studio too, whoever made it.
      const label = ORDER_STATUS_LABELS[to].title;
      this.notifications.alertStudio(
        `Order ${contact.orderNumber}: ${label}`,
        [
          `Order ${contact.orderNumber} (${contact.email}) is now: ${label}.`,
          ...(note ? [`Note: ${note}`] : []),
        ],
        `/admin/orders/${orderId}`,
      );
    }
    return { id: orderId, status: to, previousStatus: order.status };
  }
}
