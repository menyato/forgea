import Big from 'big.js';
import { describe, expect, it } from 'vitest';
import {
  type OrderLineInput,
  orderLinesFromCart,
  OrderPricer,
  type OrderSettings,
} from './order-pricer.js';

const settings: OrderSettings = {
  rushFeePercent: '30',
  deliveryFee: '25',
  depositPercent: '50',
  // The rule before amounts: made-to-order lines pay it.
  depositEnabled: true,
  depositAboveTotal: null,
  depositOnCustom: true,
  bulkDiscountTiers: [
    { minQuantity: 25, percent: '10' },
    { minQuantity: 10, percent: '5' },
  ],
};

const catalogLine: OrderLineInput = {
  id: 'p1',
  name: 'Desk organizer',
  unitPrice: '122.10',
  quantity: 12,
  isCustom: false,
};
const customLine: OrderLineInput = {
  id: 'q1',
  name: 'Custom enclosure',
  unitPrice: '50',
  quantity: 1,
  isCustom: true,
};

const sum = (amounts: string[]) =>
  amounts.reduce((a, b) => a.plus(b), new Big(0)).toFixed(2);

describe('OrderPricer', () => {
  it('prices a full order with every line labeled', () => {
    // Organizer: 12 × 122.10 = 1465.20, 5% tier → 1391.94. Enclosure: 50.00.
    // Items 1515.20 · discount −73.26 · rush 30% of 1441.94 = 432.58 · delivery 25 → 1899.52
    const quote = new OrderPricer(settings).quote([catalogLine, customLine], {
      rush: true,
      delivery: true,
    });

    expect(quote.lines).toEqual([
      {
        id: 'p1',
        name: 'Desk organizer',
        quantity: 12,
        unitPrice: '122.10',
        grossTotal: '1465.20',
        discountPercent: '5',
        lineTotal: '1391.94',
        isCustom: false,
      },
      {
        id: 'q1',
        name: 'Custom enclosure',
        quantity: 1,
        unitPrice: '50.00',
        grossTotal: '50.00',
        discountPercent: '0',
        lineTotal: '50.00',
        isCustom: true,
      },
    ]);
    expect(quote.summary).toEqual([
      { kind: 'items', label: 'Items', amount: '1515.20' },
      { kind: 'bulk-discount', label: 'Bulk discount', amount: '-73.26' },
      { kind: 'rush-fee', label: 'Rush fee (30%)', amount: '432.58' },
      { kind: 'delivery-fee', label: 'Delivery', amount: '25.00' },
    ]);
    expect(quote.total).toBe('1899.52');
    expect(quote.depositRequired).toBe('25.00');
  });

  it('total always equals the sum of the summary lines', () => {
    const pricer = new OrderPricer(settings);
    for (const quantity of [1, 9, 10, 24, 25, 101]) {
      for (const rush of [true, false]) {
        for (const delivery of [true, false]) {
          const quote = pricer.quote(
            [{ ...catalogLine, quantity, unitPrice: '13.37' }, customLine],
            {
              rush,
              delivery,
            },
          );
          expect(sum(quote.summary.map((l) => l.amount))).toBe(quote.total);
        }
      }
    }
  });

  it('omits rush, delivery and discount lines that do not apply', () => {
    const quote = new OrderPricer(settings).quote([customLine], {
      rush: false,
      delivery: false,
    });
    expect(quote.summary).toEqual([
      { kind: 'items', label: 'Items', amount: '50.00' },
    ]);
    expect(quote.total).toBe('50.00');
  });

  it('picks the best bulk tier a line qualifies for', () => {
    const pricer = new OrderPricer(settings);
    expect(pricer.discountFor(9).toString()).toBe('0');
    expect(pricer.discountFor(10).toString()).toBe('5');
    expect(pricer.discountFor(24).toString()).toBe('5');
    expect(pricer.discountFor(25).toString()).toBe('10');
    expect(pricer.discountFor(500).toString()).toBe('10');
  });

  it('does not depend on the order tiers are listed in', () => {
    const reversed = new OrderPricer({
      ...settings,
      bulkDiscountTiers: [...settings.bulkDiscountTiers].reverse(),
    });
    expect(reversed.discountFor(30).toString()).toBe('10');
  });

  it('charges the deposit only on custom items, after their discount', () => {
    const quote = new OrderPricer(settings).quote(
      [catalogLine, { ...customLine, quantity: 10, unitPrice: '20' }],
      { rush: false, delivery: true },
    );
    // Custom line: 10 × 20 = 200, 5% tier → 190; deposit 50% → 95.
    expect(quote.depositRequired).toBe('95.00');
  });

  it('requires no deposit for catalog-only orders', () => {
    const quote = new OrderPricer(settings).quote([catalogLine], {
      rush: false,
      delivery: false,
    });
    expect(quote.depositRequired).toBe('0.00');
  });

  it('works with no bulk tiers configured', () => {
    const quote = new OrderPricer({ ...settings, bulkDiscountTiers: [] }).quote(
      [catalogLine],
      {
        rush: false,
        delivery: false,
      },
    );
    expect(quote.total).toBe('1465.20');
  });

  describe('rejects invalid settings', () => {
    it.each([
      [{ rushFeePercent: '150' }, /rushFeePercent must be between 0 and 100/],
      [{ deliveryFee: '-5' }, /deliveryFee must not be negative/],
      [{ depositPercent: 'half' }, /depositPercent must be a decimal number/],
      [
        { bulkDiscountTiers: [{ minQuantity: 1, percent: '5' }] },
        /minQuantity must be an integer of at least 2/,
      ],
      [
        { bulkDiscountTiers: [{ minQuantity: 2.5, percent: '5' }] },
        /minQuantity must be an integer/,
      ],
      [
        {
          bulkDiscountTiers: [
            { minQuantity: 10, percent: '5' },
            { minQuantity: 10, percent: '8' },
          ],
        },
        /two tiers for 10 units/,
      ],
      [
        { bulkDiscountTiers: [{ minQuantity: 10, percent: '120' }] },
        /percent must be between 0 and 100/,
      ],
    ] as const)('%o', (override, message) => {
      expect(() => new OrderPricer({ ...settings, ...override })).toThrow(
        message,
      );
    });
  });

  describe('rejects invalid lines', () => {
    const pricer = new OrderPricer(settings);
    const options = { rush: false, delivery: false };

    it('an empty order', () => {
      expect(() => pricer.quote([], options)).toThrow(/at least one line/);
    });

    it.each([0, -2, 1.5])('quantity %s', (quantity) => {
      expect(() =>
        pricer.quote([{ ...catalogLine, quantity }], options),
      ).toThrow(/lines\[0\]\.quantity must be a whole number/);
    });

    it('a negative unit price', () => {
      expect(() =>
        pricer.quote([{ ...catalogLine, unitPrice: '-1' }], options),
      ).toThrow(/lines\[0\]\.unitPrice must not be negative/);
    });
  });
});

describe('orderLinesFromCart', () => {
  it('maps cart lines to pricing input', () => {
    expect(
      orderLinesFromCart([
        {
          id: 'line-1',
          name: 'N',
          unitPrice: '1.50',
          quantity: 3,
          isCustom: true,
        },
      ]),
    ).toEqual([
      {
        id: 'line-1',
        name: 'N',
        unitPrice: '1.50',
        quantity: 3,
        isCustom: true,
      },
    ]);
  });

  describe('deposit rules', () => {
    const shop = (over: Partial<OrderSettings>) =>
      new OrderPricer({
        ...settings,
        depositOnCustom: false,
        depositAboveTotal: '30',
        ...over,
      });
    const line = (unitPrice: string, isCustom = false): OrderLineInput => ({
      id: unitPrice,
      name: 'Piece',
      unitPrice,
      quantity: 1,
      isCustom,
    });

    it('by default only an order above $30 pays half of its items upfront', () => {
      expect(
        shop({}).quote([line('30')], { delivery: true, rush: false })
          .depositRequired,
      ).toBe('0.00');
      expect(
        shop({}).quote([line('30.01')], { delivery: true, rush: false })
          .depositRequired,
      ).toBe('15.01');
      // A custom piece under the amount pays none, unless custom pieces always do.
      expect(
        shop({}).quote([line('4', true)], { delivery: false, rush: false })
          .depositRequired,
      ).toBe('0.00');
      expect(
        shop({ depositOnCustom: true }).quote([line('4', true)], {
          delivery: false,
          rush: false,
        }).depositRequired,
      ).toBe('2.00');
    });

    it('takes it on all the items above the amount, delivery and rush aside', () => {
      const q = shop({}).quote([line('20'), line('20', true)], {
        delivery: true,
        rush: true,
      });
      expect(q.depositRequired).toBe('20.00');
    });

    it('asks none when switched off, and none by amount without one', () => {
      expect(
        shop({ depositEnabled: false }).quote([line('500', true)], {
          delivery: false,
          rush: false,
        }).depositRequired,
      ).toBe('0.00');
      expect(
        shop({ depositAboveTotal: null }).quote([line('500')], {
          delivery: false,
          rush: false,
        }).depositRequired,
      ).toBe('0.00');
    });
  });
});
