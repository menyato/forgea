import {
  generateOrderNumber,
  generateRequestNumber,
  ORDER_NUMBER_PATTERN,
  REQUEST_NUMBER_PATTERN,
} from './order-number.js';

describe('generateOrderNumber', () => {
  it('matches the format the database enforces', () => {
    for (let i = 0; i < 1000; i++)
      expect(generateOrderNumber()).toMatch(ORDER_NUMBER_PATTERN);
  });

  it('makes custom request numbers the same way, with their own prefix', () => {
    for (let i = 0; i < 1000; i++)
      expect(generateRequestNumber()).toMatch(REQUEST_NUMBER_PATTERN);
  });

  it('is not sequential or repeated', () => {
    const numbers = new Set(
      Array.from({ length: 10_000 }, generateOrderNumber),
    );
    expect(numbers.size).toBe(10_000);
  });

  it('uses every character of the alphabet roughly evenly', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 5000; i++) {
      for (const ch of generateOrderNumber().slice(3))
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    expect(counts.size).toBe(32);
    // 50,000 characters / 32 ≈ 1,562 each; allow generous random variation.
    for (const n of counts.values()) expect(n).toBeGreaterThan(1300);
  });
});
