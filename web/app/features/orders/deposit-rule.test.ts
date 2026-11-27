import { describe, expect, it } from 'vitest';
import { depositRule } from './deposit-rule';

const shop = {
  rushFeePercent: '20',
  deliveryFee: '4',
  depositPercent: '50',
  depositEnabled: true,
  depositAboveTotal: '30',
  depositOnCustom: false,
  bulkDiscountTiers: [],
};

describe('depositRule', () => {
  it('says the rule as the customer reads it', () => {
    expect(depositRule(shop)).toBe('A 50% deposit starts orders above $30.');
    expect(depositRule({ ...shop, depositOnCustom: true })).toBe(
      'A 50% deposit starts made-to-order pieces and orders above $30.',
    );
    expect(
      depositRule({ ...shop, depositAboveTotal: null, depositOnCustom: true }),
    ).toBe('A 50% deposit starts made-to-order pieces.');
  });
  it('says nothing when no order pays one', () => {
    expect(depositRule({ ...shop, depositEnabled: false })).toBeNull();
    expect(depositRule({ ...shop, depositAboveTotal: null })).toBeNull();
  });
});
