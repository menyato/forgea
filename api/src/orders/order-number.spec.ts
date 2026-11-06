import {
  generateRequestNumber,
  ORDER_NUMBER_PATTERN,
  orderNumber,
  REQUEST_NUMBER_PATTERN,
} from './order-number.js';

describe('order numbers', () => {
  it('are the year and a running count, four digits at least', () => {
    expect(orderNumber(2026, 1)).toBe('FG-2026-0001');
    expect(orderNumber(2026, 42)).toBe('FG-2026-0042');
    expect(orderNumber(2027, 12345)).toBe('FG-2027-12345');
    for (const n of [1, 9999, 10000])
      expect(orderNumber(2026, n)).toMatch(ORDER_NUMBER_PATTERN);
  });

  it('still accept the random numbers given before', () => {
    expect('FG-7K2M9QX4PB').toMatch(ORDER_NUMBER_PATTERN);
    expect('FG-2026-01').not.toMatch(ORDER_NUMBER_PATTERN);
  });
});

describe('generateRequestNumber', () => {
  it('matches the format the database enforces', () => {
    for (let i = 0; i < 1000; i++)
      expect(generateRequestNumber()).toMatch(REQUEST_NUMBER_PATTERN);
  });

  it('is not sequential or repeated', () => {
    const numbers = new Set(
      Array.from({ length: 10_000 }, generateRequestNumber),
    );
    expect(numbers.size).toBe(10_000);
  });

  it('uses every character of the alphabet roughly evenly', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 5000; i++) {
      for (const ch of generateRequestNumber().slice(3))
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    expect(counts.size).toBe(32);
    // 50,000 characters / 32 ≈ 1,562 each; allow generous random variation.
    for (const n of counts.values()) expect(n).toBeGreaterThan(1300);
  });
});
