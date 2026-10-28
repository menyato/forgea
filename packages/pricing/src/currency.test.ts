import { describe, expect, it } from 'vitest';
import { CurrencyConverter, formatMoney } from './currency.js';

const USD = { code: 'USD', decimals: 2, roundingStep: '0.01' };
const LBP = { code: 'LBP', decimals: 0, roundingStep: '5000' };

describe('CurrencyConverter', () => {
  it('converts the base currency to LBP, rounded half up to the cash step', () => {
    const lbp = new CurrencyConverter(LBP, '89500');
    // 1899.52 × 89,500 = 170,007,040 → 170,005,000
    expect(lbp.convert('1899.52')).toBe('170005000');
    // 25 × 89,500 = 2,237,500, exactly half a step → rounds up
    expect(lbp.convert('25')).toBe('2240000');
    expect(lbp.convert('0')).toBe('0');
    expect(lbp.exchangeRate).toBe('89500');
    expect(lbp.code).toBe('LBP');
  });

  it('is the identity for the base currency at rate 1', () => {
    expect(new CurrencyConverter(USD, 1).convert('12.345')).toBe('12.35');
  });

  it('handles fractional rates such as EUR', () => {
    const eur = new CurrencyConverter(
      { code: 'EUR', decimals: 2, roundingStep: '0.01' },
      '0.92',
    );
    expect(eur.convert('10')).toBe('9.20');
  });

  it.each([
    [{ ...LBP, code: 'lbp' }, '89500', /3 capital letters/],
    [
      { ...LBP, decimals: 5 },
      '89500',
      /decimals must be a whole number from 0 to 4/,
    ],
    [{ ...LBP, decimals: 1.5 }, '89500', /decimals must be a whole number/],
    [
      { ...LBP, roundingStep: '0' },
      '89500',
      /roundingStep must be greater than 0/,
    ],
    [LBP, '0', /rate must be greater than 0/],
    [LBP, '-1', /rate must be greater than 0/],
  ])('rejects %o at rate %s', (currency, rate, message) => {
    expect(() => new CurrencyConverter(currency, rate)).toThrow(message);
  });
});

describe('formatMoney', () => {
  it('formats USD with cents and grouping', () => {
    expect(formatMoney('1234.5', USD)).toBe('$1,234.50');
  });

  it('formats LBP with grouping and no decimals', () => {
    expect(formatMoney('170005000', LBP)).toMatch(/^LBP\s170,005,000$/);
  });
});
