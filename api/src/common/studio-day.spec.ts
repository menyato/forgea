import { describe, expect, it } from 'vitest';
import { studioDay, studioToday, studioYear } from './studio-day.js';

describe('the studio day (Beirut)', () => {
  it('is already the next day after 22:00 UTC in winter', () => {
    const at = new Date('2026-12-31T22:30:00Z');
    expect(studioDay(at)).toBe('2027-01-01');
    expect(studioYear(at)).toBe(2027);
    expect(studioToday(at).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
  it('is the same day earlier on', () => {
    expect(studioDay(new Date('2026-11-06T10:00:00Z'))).toBe('2026-11-06');
  });
});
