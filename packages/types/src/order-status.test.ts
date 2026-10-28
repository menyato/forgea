import { describe, expect, it } from 'vitest';
import { OrderStatus } from './generated/prisma/enums.js';
import {
  canChangeOrderStatus,
  ORDER_STATUS_FLOW,
  ORDER_STATUS_LABELS,
} from './order-status.js';

describe('order status flow', () => {
  it('covers every status, with customer wording for each', () => {
    for (const status of Object.values(OrderStatus)) {
      expect(ORDER_STATUS_FLOW[status]).toBeDefined();
      expect(ORDER_STATUS_LABELS[status].title.length).toBeGreaterThan(0);
    }
  });

  it('allows the normal journey', () => {
    const journey = [
      OrderStatus.PENDING,
      OrderStatus.CONFIRMED,
      OrderStatus.IN_PRODUCTION,
      OrderStatus.READY,
      OrderStatus.OUT_FOR_DELIVERY,
      OrderStatus.DELIVERED,
    ];
    for (let i = 1; i < journey.length; i++) {
      expect(canChangeOrderStatus(journey[i - 1]!, journey[i]!)).toBe(true);
    }
  });

  it('never moves backwards or out of a final state', () => {
    expect(
      canChangeOrderStatus(OrderStatus.DELIVERED, OrderStatus.IN_PRODUCTION),
    ).toBe(false);
    expect(
      canChangeOrderStatus(OrderStatus.CANCELLED, OrderStatus.CONFIRMED),
    ).toBe(false);
    expect(
      canChangeOrderStatus(OrderStatus.IN_PRODUCTION, OrderStatus.PENDING),
    ).toBe(false);
  });

  it('requires the deposit before production for custom orders', () => {
    expect(
      canChangeOrderStatus(
        OrderStatus.AWAITING_DEPOSIT,
        OrderStatus.IN_PRODUCTION,
      ),
    ).toBe(false);
  });
});
