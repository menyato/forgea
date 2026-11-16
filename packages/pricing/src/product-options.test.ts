import { describe, expect, it } from 'vitest';
import { PricingError } from './errors.js';
import {
  averagePricePerGram,
  configuredUnitCost,
  configuredUnitPrice,
  overriddenUnitPrice,
  configureUnit,
  type OptionEffect,
} from './product-options.js';
import { UnitCostCalculator } from './unit-cost-calculator.js';

const base = { grams: '100', printHours: '4', pricePerGram: '0.05' };
const none = { gramsMultiplier: 1, hoursMultiplier: 1, extraPrice: 0 };
const large: OptionEffect = {
  label: 'Size: Large',
  ...none,
  gramsMultiplier: '1.8',
  hoursMultiplier: '1.5',
};
const silk: OptionEffect = {
  label: 'Colour: Copper silk',
  ...none,
  extraPrice: '2.5',
};
const petg: OptionEffect = {
  label: 'Material: PETG',
  ...none,
  pricePerGram: '0.07',
};

describe('configureUnit', () => {
  it('leaves the product as it is without options', () => {
    expect(configureUnit(base, [])).toEqual({
      input: { grams: '100', printHours: '4', pricePerGram: '0.05' },
      extraPrice: '0.00',
    });
  });

  it('compounds multipliers, sums add-ons and switches the material', () => {
    const half: OptionEffect = {
      label: 'Fill: Light',
      ...none,
      gramsMultiplier: '0.5',
    };
    expect(configureUnit(base, [large, silk, petg, half])).toEqual({
      input: { grams: '90', printHours: '6', pricePerGram: '0.07' },
      extraPrice: '2.50',
    });
  });

  it('treats a null material as "no change"', () => {
    expect(
      configureUnit(base, [{ ...silk, pricePerGram: null }]).input.pricePerGram,
    ).toBe('0.05');
  });

  it('refuses two options that both set the material', () => {
    const pla = { ...petg, label: 'Finish: Matte PLA', pricePerGram: '0.04' };
    expect(() => configureUnit(base, [petg, pla])).toThrow(
      'Both "Material: PETG" and "Finish: Matte PLA" set the material',
    );
  });

  it.each([
    [
      { ...large, gramsMultiplier: 0 },
      'Size: Large: grams multiplier must be greater than 0',
    ],
    [
      { ...large, hoursMultiplier: '-1' },
      'Size: Large: hours multiplier must be greater than 0',
    ],
    [
      { ...silk, extraPrice: '-1' },
      'Colour: Copper silk: extra price must not be negative',
    ],
    [
      { ...petg, pricePerGram: '-0.1' },
      'Material: PETG: price per gram must not be negative',
    ],
  ])('rejects a misconfigured option (%#)', (effect, message) => {
    expect(() => configureUnit(base, [effect])).toThrow(
      new PricingError(message),
    );
  });
});

describe('configuredUnitPrice', () => {
  const calculator = new UnitCostCalculator({
    machineRatePerHour: 0,
    purgeWastePercent: 0,
    failureAllowancePercent: 0,
    laborCostPerUnit: 0,
    packagingCostPerUnit: 0,
    profit: { kind: 'PERCENT', value: 100 },
  });

  it('prices the configured print, then adds the fixed add-ons after markup', () => {
    // 100 g × 1.8 × $0.05 = $9 → ×2 markup = $18, + $2.50 silk = $20.50
    expect(configuredUnitPrice(calculator, base, [large, silk])).toBe('20.50');
  });
});

describe('configuredUnitCost', () => {
  const calculator = new UnitCostCalculator({
    machineRatePerHour: 1,
    purgeWastePercent: 10,
    failureAllowancePercent: 10,
    laborCostPerUnit: '0.5',
    packagingCostPerUnit: '0.5',
    profit: { kind: 'PERCENT', value: 100 },
  });

  it('is the cost before markup, without the add-ons, with the grams it takes', () => {
    // 180 g × $0.05 = $9 + 6 h × $1 = $15; +10% waste +10% failures = $18; + $1 = $19.
    expect(configuredUnitCost(calculator, base, [large, silk])).toEqual({
      cost: '19.00',
      grams: '180',
      hours: '6',
    });
  });

  it("adds no purge waste when the grams are a slicer's own", () => {
    // $15 + 10% failures = $16.50; + $1 = $17.50.
    expect(
      configuredUnitCost(calculator, { ...base, wasteIncluded: true }, [large]),
    ).toMatchObject({ cost: '17.50' });
  });

  it("counts the product's extra parts once a piece, whatever the size or options", () => {
    // $19 as above + a $0.40 key ring (not scaled by the bigger size).
    expect(
      configuredUnitCost(calculator, { ...base, extraCost: '0.40' }, [
        large,
        silk,
      ]),
    ).toMatchObject({ cost: '19.40' });
  });
});

describe('overriddenUnitPrice', () => {
  it('sells at the owner price when nothing is chosen beyond the product itself', () => {
    expect(overriddenUnitPrice('25', '18.40', '18.40')).toBe('25.00');
  });

  it('adds what a bigger size or an add-on adds to the calculated price', () => {
    expect(overriddenUnitPrice('25', '18.40', '22.15')).toBe('28.75');
  });

  it('takes off what a smaller size takes off, never going below zero', () => {
    expect(overriddenUnitPrice('25', '18.40', '15.40')).toBe('22.00');
    expect(overriddenUnitPrice('2', '18.40', '10.00')).toBe('0.00');
  });
});

describe('averagePricePerGram', () => {
  it("weighs each filament's own price by its grams; one without a price takes the material's", () => {
    // 20 g at $0.017 + 5 g at the material's $0.02 = $0.44 over 25 g.
    expect(
      averagePricePerGram('0.02', [
        { grams: '20', pricePerGram: '0.017' },
        { grams: '5', pricePerGram: null },
      ]),
    ).toBe('0.0176');
  });

  it("is the material's price for a product without colours", () => {
    expect(averagePricePerGram('0.02', [])).toBe('0.02');
  });
});
