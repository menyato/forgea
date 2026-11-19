import { describe, expect, it } from 'vitest';
import { formatHours } from './duration';

describe('formatHours', () => {
  it('says print times as people do', () => {
    expect(formatHours('0.05')).toBe('3 min');
    expect(formatHours(0)).toBe('0 min');
    expect(formatHours('1.5')).toBe('1 h 30 min');
    expect(formatHours(12)).toBe('12 h');
    expect(formatHours('15.38')).toBe('15 h 23 min');
    expect(formatHours('0.999')).toBe('1 h');
  });
  it('shows a dash for nothing', () => {
    expect(formatHours(null)).toBe('—');
    expect(formatHours('')).toBe('—');
    expect(formatHours('abc')).toBe('—');
  });
});
