import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type ChosenOption,
  ORDER_STATUS_FLOW,
  type OrderListItem,
  type Page,
  type StaffOrder,
} from '@forgea/types';
import type { OrderListQuery } from '@forgea/validation';
import type { OrderStatus } from '../generated/prisma/enums.js';
import { toPage } from '../common/pagination/keyset.js';
import { Invoicing } from '../accounting/invoicing.service.js';
import type { Measurement } from '../text-studio/text-studio.service.js';
import { OrdersRepository, type StaffOrderRow } from './orders.repository.js';

@Injectable()
export class OrdersService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly invoicing: Invoicing,
  ) {}

  counts(): Promise<Partial<Record<OrderStatus, number>>> {
    return this.orders.countByStatus();
  }

  async list(query: OrderListQuery): Promise<Page<OrderListItem>> {
    return toPage(await this.orders.list(query), (o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      customerEmail: o.user.email,
      total: o.total.toFixed(2),
      currencyCode: o.currencyCode,
      totalInCurrency: o.totalInCurrency.toString(),
      depositRequired: o.depositRequired.toFixed(2),
      depositPaid: o.depositPaid,
      createdAt: o.createdAt.toISOString(),
    }));
  }

  /** `withInvoices`: the caller may see invoices; otherwise they are left out, not just hidden. */
  async detail(id: string, withInvoices: boolean): Promise<StaffOrder> {
    const o = await this.orders.findForStaff(id);
    if (!o) throw new NotFoundException('Order not found');
    return {
      ...toStaffOrder(o),
      invoices: withInvoices ? await this.invoicing.forOrder(id) : null,
    };
  }
}

function toStaffOrder(o: StaffOrderRow): Omit<StaffOrder, 'invoices'> {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    nextStatuses: [...ORDER_STATUS_FLOW[o.status]],
    paymentMethod: o.paymentMethod,
    customer: { name: o.customerName, email: o.user.email, phone: o.phone },
    delivery: o.delivery,
    rush: o.rush,
    city: o.city,
    addressLine: o.addressLine,
    deliveryNotes: o.deliveryNotes,
    items: o.items.map((i) => ({
      id: i.id,
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice.toFixed(2),
      lineTotal: i.lineTotal.toFixed(2),
      isCustom: i.isCustom,
      // A snapshot written at checkout: [{ group, value }].
      options: i.options as unknown as ChosenOption[],
      productSlug: i.product?.slug ?? null,
      design: staffDesign(i.id, i.design),
      // The 3MF it is made from (a quotation line, a request), or its product's.
      printProject:
        !i.design &&
        (i.printFile !== null || !!i.product?.modelFileKey?.endsWith('.3mf')),
      // Its product's sliced print files (a line with its own file prints from that one).
      printFiles:
        i.design || i.printFile !== null ? [] : (i.product?.printFiles ?? []),
    })),
    priceBreakdown: (
      o.priceBreakdown as unknown as { label: string; amount: string }[]
    ).map((l) => ({ label: l.label, amount: l.amount })),
    total: o.total.toFixed(2),
    depositRequired: o.depositRequired.toFixed(2),
    depositPaid: o.depositPaid,
    currencyCode: o.currencyCode,
    exchangeRate: o.exchangeRate.toString(),
    totalInCurrency: o.totalInCurrency.toString(),
    depositInCurrency: o.depositInCurrency.toString(),
    history: o.statusHistory.map((h) => ({
      status: h.status,
      changedAt: h.changedAt.toISOString(),
      note: h.note,
      changedBy: h.changedBy?.email ?? null,
    })),
    customRequestNumber: o.customRequest?.requestNumber ?? null,
    createdAt: o.createdAt.toISOString(),
  };
}

/** A personalised piece as the studio prints it: how it reads, and one print file per colour. */
function staffDesign(
  itemId: string,
  snapshot: unknown,
): StaffOrder['items'][number]['design'] {
  const m = snapshot as Measurement | null;
  if (!m) return null;
  return {
    ...m.summary,
    itemId,
    files: m.colours.map((c) => ({ colour: c.label })),
  };
}
