import { describe, expect, it } from 'vitest';
import {
  pricePerGramFromReel,
  printerHourlyRate,
  splitPrinterCost,
} from './setup-rates.js';

describe('pricePerGramFromReel', () => {
  it("is the reel's price over its weight, to four decimals", () => {
    expect(pricePerGramFromReel('22', 1000)).toBe('0.0220');
    expect(pricePerGramFromReel('19.99', '750')).toBe('0.0267');
  });

  it('refuses a reel that weighs nothing or costs less than nothing', () => {
    expect(() => pricePerGramFromReel('22', 0)).toThrow(/above 0/);
    expect(() => pricePerGramFromReel('-1', 1000)).toThrow(/not be negative/);
  });
});

describe('printerHourlyRate', () => {
  it("spreads the printer's price over its life and adds its electricity", () => {
    // $600 / 6000 h = $0.10; 150 W = 0.15 kWh × $0.30 = $0.045 → $0.145 → $0.15.
    expect(
      printerHourlyRate({
        printerPrice: '600',
        lifeHours: 6000,
        watts: 150,
        electricityPerKwh: '0.30',
      }),
    ).toBe('0.15');
  });

  it('refuses a printer with no life', () => {
    expect(() =>
      printerHourlyRate({
        printerPrice: '600',
        lifeHours: 0,
        watts: 150,
        electricityPerKwh: '0.3',
      }),
    ).toThrow(/above 0 hours/);
  });
});

describe('splitPrinterCost', () => {
  const printer = {
    printerPrice: '600',
    lifeHours: 6000,
    watts: 150,
    electricityPerKwh: '0.30',
  };

  it('shares printer time between wear and electricity, adding up to it', () => {
    // An hour is $0.10 wear + $0.045 power: 31.03% of $4.00 is electricity.
    expect(splitPrinterCost(printer, '4.00')).toEqual({
      wear: '2.76',
      electricity: '1.24',
    });
  });

  it('is all wear for a printer that costs nothing to run or own', () => {
    expect(
      splitPrinterCost({ ...printer, printerPrice: 0, watts: 0 }, '4.00'),
    ).toEqual({ wear: '4.00', electricity: '0.00' });
  });
});
