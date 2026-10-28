import { OrderStatus } from './generated/prisma/enums.js';

/**
 * Which status may follow which. Enforced by the API when staff change an order, and used
 * by the dashboard to offer only valid next steps. Delivered and cancelled are final.
 */
export const ORDER_STATUS_FLOW: Readonly<
  Record<OrderStatus, readonly OrderStatus[]>
> = {
  [OrderStatus.PENDING]: [
    OrderStatus.AWAITING_DEPOSIT,
    OrderStatus.CONFIRMED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.AWAITING_DEPOSIT]: [
    OrderStatus.CONFIRMED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.CONFIRMED]: [OrderStatus.IN_PRODUCTION, OrderStatus.CANCELLED],
  [OrderStatus.IN_PRODUCTION]: [OrderStatus.READY, OrderStatus.CANCELLED],
  // Pickup orders go straight from ready to delivered.
  [OrderStatus.READY]: [
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.DELIVERED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.OUT_FOR_DELIVERY]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [],
};

export function canChangeOrderStatus(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  return ORDER_STATUS_FLOW[from].includes(to);
}

/** Customer-facing wording, shared by the storefront and (Phase 9) the status emails. */
export const ORDER_STATUS_LABELS: Readonly<
  Record<OrderStatus, { title: string; detail: string }>
> = {
  [OrderStatus.PENDING]: {
    title: 'Order received',
    detail: 'We have your order and will confirm it shortly.',
  },
  [OrderStatus.AWAITING_DEPOSIT]: {
    title: 'Waiting for deposit',
    detail: 'Custom items start once the 50% deposit arrives.',
  },
  [OrderStatus.CONFIRMED]: {
    title: 'Confirmed',
    detail: 'Your order is confirmed and scheduled for production.',
  },
  [OrderStatus.IN_PRODUCTION]: {
    title: 'In production',
    detail: 'Your order is being printed and finished.',
  },
  [OrderStatus.READY]: {
    title: 'Ready',
    detail: 'Your order is ready for delivery or pickup.',
  },
  [OrderStatus.OUT_FOR_DELIVERY]: {
    title: 'Out for delivery',
    detail: 'Our courier is on the way.',
  },
  [OrderStatus.DELIVERED]: {
    title: 'Delivered',
    detail: 'Enjoy it — thank you for ordering from Forgea.',
  },
  [OrderStatus.CANCELLED]: {
    title: 'Cancelled',
    detail: 'This order was cancelled.',
  },
};
