import type { CartLine, CurrencyQuote } from '@forgea/types';
import { describe, expect, it } from 'vitest';
import { quoteFor } from './live-quote';

const settings = {
  rushFeePercent: '30',
  deliveryFee: '5',
  depositPercent: '50',
  depositEnabled: true,
  depositAboveTotal: null,
  depositOnCustom: true,
  bulkDiscountTiers: [{ minQuantity: 10, percent: '5' }],
};
const currencies: CurrencyQuote[] = [
  {
    code: 'USD',
    name: 'US dollar',
    decimals: 2,
    roundingStep: '0.01',
    isBase: true,
    rate: '1',
    rateEffectiveFrom: null,
  },
  {
    code: 'LBP',
    name: 'Lebanese pound',
    decimals: 0,
    roundingStep: '5000',
    isBase: false,
    rate: '89500',
    rateEffectiveFrom: null,
  },
];
const line = (over: Partial<CartLine> = {}): CartLine => ({
  id: 'line-1',
  productId: 'p1',
  slug: 'stand',
  name: 'Phone stand',
  materialCode: 'PLA',
  unitPrice: '13.91',
  quantity: 2,
  isCustom: false,
  options: [],
  design: null,
  slots: [],
  freeOfferId: null,
  ...over,
});

describe('quoteFor (live totals in the browser)', () => {
  it('matches what the API charges at checkout: 2 × $13.91 + $5 delivery', () => {
    const q = quoteFor(
      [line()],
      settings,
      { rush: false, delivery: true },
      currencies,
      'USD',
    );
    expect(q?.quote.total).toBe('32.82');
    expect(q?.totalInCurrency).toBe('32.82');
  });

  it('converts to LBP at the admin-set rate with cash rounding', () => {
    const q = quoteFor(
      [line()],
      settings,
      { rush: false, delivery: true },
      currencies,
      'LBP',
    );
    // 32.82 × 89,500 = 2,937,390 → nearest 5,000
    expect(q?.totalInCurrency).toBe('2935000');
  });

  it('updates with rush and pickup', () => {
    const q = quoteFor(
      [line()],
      settings,
      { rush: true, delivery: false },
      currencies,
      'USD',
    );
    // 27.82 + 30% rush (8.35)
    expect(q?.quote.total).toBe('36.17');
  });

  it('shows the deposit for custom items', () => {
    const q = quoteFor(
      [line({ isCustom: true, quantity: 1 })],
      settings,
      { rush: false, delivery: false },
      currencies,
      'USD',
    );
    expect(q?.quote.depositRequired).toBe('6.96');
  });

  it('is null for an empty cart and falls back to USD for an unknown currency', () => {
    expect(
      quoteFor(
        [],
        settings,
        { rush: false, delivery: true },
        currencies,
        'USD',
      ),
    ).toBeNull();
    expect(
      quoteFor(
        [line()],
        settings,
        { rush: false, delivery: true },
        currencies,
        'EUR',
      )?.currency.code,
    ).toBe('USD');
  });
});
