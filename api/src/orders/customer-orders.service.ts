import { Injectable } from '@nestjs/common';
import type { CustomerOrder, Page } from '@forgea/types';
import type { MyOrdersQuery } from '@forgea/validation';
import { toPage } from '../common/pagination/keyset.js';
import {
  OrdersRepository,
  type CustomerOrderRow,
} from './orders.repository.js';

/** Orders as their customers see them ("My Orders"). */
@Injectable()
export class CustomerOrdersService {
  constructor(private readonly orders: OrdersRepository) {}

  async mine(
    userId: string,
    query: MyOrdersQuery,
  ): Promise<Page<CustomerOrder>> {
    return toPage(
      await this.orders.listForUser(userId, query),
      toCustomerOrder,
    );
  }
}

/** No address, phone or internal ids: only what the customer needs to follow the order. */
function toCustomerOrder(o: CustomerOrderRow): CustomerOrder {
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
    })),
    history: o.statusHistory.map((h) => ({
      status: h.status,
      changedAt: h.changedAt.toISOString(),
      note: h.note,
    })),
    createdAt: o.createdAt.toISOString(),
  };
}
