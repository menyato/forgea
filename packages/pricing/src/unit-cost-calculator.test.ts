import { describe, expect, it } from 'vitest';
import { PricingError } from './errors.js';
import {
  type CostSettings,
  type ProfitRule,
  UnitCostCalculator,
} from './unit-cost-calculator.js';

const settings: CostSettings = {
  machineRatePerHour: '10',
  purgeWastePercent: '5',
  failureAllowancePercent: '10',
  laborCostPerUnit: '5',
  packagingCostPerUnit: '3',
  profit: { kind: 'PERCENT', value: '60' },
};

const zero: CostSettings = {
  machineRatePerHour: 0,
  purgeWastePercent: 0,
  failureAllowancePercent: 0,
  laborCostPerUnit: 0,
  packagingCostPerUnit: 0,
  profit: { kind: 'PERCENT', value: 0 },
};

describe('UnitCostCalculator', () => {
  it('applies every formula from the spec', () => {
    // material 120 × 0.12 = 14.40 · machine 4.5 × 10 = 45.00 · base 59.40
    // waste 5% = 2.97 · failure 10% = 5.94 · subtotal 59.40 + 2.97 + 5.94 + 5 + 3 = 76.31
    // price 76.31 × 1.6 = 122.096 → 122.10
    const result = new UnitCostCalculator(settings).price({
      grams: '120',
      printHours: '4.5',
      pricePerGram: '0.12',
    });
    expect(result).toEqual({
      materialCost: '14.40',
      machineCost: '45.00',
      wasteCost: '2.97',
      failureAllowance: '5.94',
      laborCost: '5.00',
      packagingCost: '3.00',
      extraCost: '0.00',
      subtotal: '76.31',
      profit: '45.79',
      profitRule: { kind: 'PERCENT', value: '60' },
      unitPrice: '122.10',
    });
  });

  it("adds a product's extra parts to its cost, before the profit", () => {
    // As above with a $2.50 key ring: subtotal 78.81, price 78.81 × 1.6 = 126.096 → 126.10
    const result = new UnitCostCalculator(settings).price({
      grams: '120',
      printHours: '4.5',
      pricePerGram: '0.12',
      extraCost: '2.50',
    });
    expect(result.extraCost).toBe('2.50');
    expect(result.subtotal).toBe('78.81');
    expect(result.unitPrice).toBe('126.10');
    expect(() =>
      new UnitCostCalculator(settings).price({
        grams: '1',
        printHours: '1',
        pricePerGram: '1',
        extraCost: '-1',
      }),
    ).toThrow();
  });

  it("adds no purge waste to a slicer's grams: they already hold it", () => {
    // As above without the 2.97 waste: subtotal 73.34, price 73.34 × 1.6 = 117.344 → 117.34
    const result = new UnitCostCalculator(settings).price({
      grams: '120',
      printHours: '4.5',
      pricePerGram: '0.12',
      wasteIncluded: true,
    });
    expect(result).toMatchObject({
      wasteCost: '0.00',
      failureAllowance: '5.94',
      subtotal: '73.34',
      unitPrice: '117.34',
    });
  });

  it('uses exact decimals, not floating point', () => {
    // 0.1 + 0.2 in floating point is 0.30000000000000004.
    const result = new UnitCostCalculator(zero).price({
      grams: '3',
      printHours: '0',
      pricePerGram: '0.1',
    });
    expect(result.unitPrice).toBe('0.30');
  });

  it('rounds half up to the cent', () => {
    const result = new UnitCostCalculator(zero).price({
      grams: '1',
      printHours: '0',
      pricePerGram: '0.125',
    });
    expect(result.unitPrice).toBe('0.13');
  });

  it('computes the unit price from unrounded components', () => {
    // material 0.004 rounds to 0.00 on its own, but still counts toward the price.
    const result = new UnitCostCalculator({
      ...zero,
      profit: { kind: 'PERCENT', value: 1000 },
    }).price({
      grams: '1',
      printHours: '0',
      pricePerGram: '0.004',
    });
    // 0.004 + 1000% of it = 0.044.
    expect(result.materialCost).toBe('0.00');
    expect(result.unitPrice).toBe('0.04');
  });

  it('accepts numbers as well as decimal strings', () => {
    const fromNumbers = new UnitCostCalculator({
      machineRatePerHour: 10,
      purgeWastePercent: 5,
      failureAllowancePercent: 10,
      laborCostPerUnit: 5,
      packagingCostPerUnit: 3,
      profit: { kind: 'PERCENT', value: 60 },
    }).price({ grams: 120, printHours: 4.5, pricePerGram: 0.12 });
    expect(fromNumbers.unitPrice).toBe('122.10');
  });

  it('adds a fixed profit, and a product rule wins over the shop default', () => {
    const calc = new UnitCostCalculator(settings);
    const input = { grams: 120, printHours: 4.5, pricePerGram: 0.12 };
    // Cost 76.31 (as above): + $4 fixed.
    const fixed = calc.price(input, { kind: 'FIXED', value: '4' });
    expect(fixed).toMatchObject({
      subtotal: '76.31',
      profit: '4.00',
      profitRule: { kind: 'FIXED', value: '4' },
      unitPrice: '80.31',
    });
    // 25% instead of the shop's 60%.
    expect(calc.price(input, { kind: 'PERCENT', value: 25 }).unitPrice).toBe(
      '95.39',
    );
    // No product rule: the shop's.
    expect(calc.price(input, null).unitPrice).toBe('122.10');
  });

  it.each([
    [{ kind: 'PERCENT', value: '-1' }, /must not be negative/],
    [{ kind: 'PERCENT', value: '1001' }, /at most 1000%/],
    [{ kind: 'FIXED', value: 'x' }, /must be a decimal number/],
    [{ kind: 'DOUBLE', value: '2' }, /percentage or a fixed amount/],
  ] as const)('refuses the profit rule %o', (profit, message) => {
    expect(
      () =>
        new UnitCostCalculator({
          ...settings,
          profit: profit as unknown as ProfitRule,
        }),
    ).toThrow(message);
  });

  describe('rejects invalid settings', () => {
    it.each([
      ['machineRatePerHour', '-1', /machineRatePerHour must not be negative/],
      [
        'purgeWastePercent',
        '101',
        /purgeWastePercent must be between 0 and 100/,
      ],
      [
        'failureAllowancePercent',
        '-0.5',
        /failureAllowancePercent must be between 0 and 100/,
      ],
      ['laborCostPerUnit', 'abc', /laborCostPerUnit must be a decimal number/],
      [
        'packagingCostPerUnit',
        Number.NaN,
        /packagingCostPerUnit must be a finite number/,
      ],
    ] as const)('%s = %s', (field, value, message) => {
      expect(
        () => new UnitCostCalculator({ ...settings, [field]: value }),
      ).toThrow(message);
    });
  });

  describe('rejects invalid inputs', () => {
    const calc = new UnitCostCalculator(settings);
    it.each([
      [
        { grams: '0', printHours: '1', pricePerGram: '0.1' },
        /grams must be greater than 0/,
      ],
      [
        { grams: '10', printHours: '-1', pricePerGram: '0.1' },
        /printHours must not be negative/,
      ],
      [
        { grams: '10', printHours: '1', pricePerGram: '-0.1' },
        /pricePerGram must not be negative/,
      ],
    ])('%o', (input, message) => {
      expect(() => calc.price(input)).toThrow(message);
    });

    it('throws PricingError so callers can map it to a 400', () => {
      expect(() =>
        calc.price({ grams: 'x', printHours: '1', pricePerGram: '1' }),
      ).toThrow(PricingError);
    });
  });
});
