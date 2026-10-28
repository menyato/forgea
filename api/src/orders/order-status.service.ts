import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { canChangeOrderStatus, ORDER_STATUS_FLOW } from '@forgea/types';
import { OrderStatus } from '../generated/prisma/enums.js';
import { Invoicing } from '../accounting/invoicing.service.js';
import { Notifications } from '../mail/notifications.service.js';
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
  ) {}

  async change(
    orderId: string,
    to: OrderStatus,
    actorUserId: string,
    note: string | undefined,
  ): Promise<StatusChange> {
    const order = await this.orders.findStatus(orderId);
    if (!order) throw new NotFoundException('Order not found');
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

    const changed = await this.orders.changeStatus(
      orderId,
      order.status,
      to,
      actorUserId,
      note ?? null,
      extra,
    );
    if (!changed)
      throw new ConflictException(
        'Someone else just changed this order. Reload and try again.',
      );
    // The invoices and payments that follow (deposit received, delivered); never blocks this.
    await this.invoicing.onOrderStatus(orderId, order.status, to, actorUserId);
    const contact = await this.orders.contactOf(orderId);
    if (contact) {
      this.notifications.send('orderStatus', {
        to: contact.email,
        orderNumber: contact.orderNumber,
        status: to,
        note: note ?? null,
      });
    }
    return { id: orderId, status: to, previousStatus: order.status };
  }
}
