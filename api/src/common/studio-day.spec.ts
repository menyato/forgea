import { describe, expect, it } from 'vitest';
import {
  studioDay,
  studioDayPlus,
  studioDayStart,
  studioToday,
  studioYear,
} from './studio-day.js';

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
  it('starts a day at Beirut midnight, in winter and in summer time', () => {
    // Winter: UTC+2. Summer (from the last Sunday of March): UTC+3.
    expect(studioDayStart('2026-11-10').toISOString()).toBe(
      '2026-11-09T22:00:00.000Z',
    );
    expect(studioDayStart('2026-07-01').toISOString()).toBe(
      '2026-06-30T21:00:00.000Z',
    );
    // An order placed at 00:12 in Beirut belongs to that day, like its invoice.
    const at = new Date('2026-11-09T22:12:00Z');
    expect(studioDayStart(studioDay(at)).getTime()).toBeLessThanOrEqual(
      at.getTime(),
    );
  });
  it('steps days across months', () => {
    expect(studioDayPlus('2026-11-01', -1)).toBe('2026-10-31');
    expect(studioDayPlus('2026-12-31', 1)).toBe('2027-01-01');
  });
});
