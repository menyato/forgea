import { describe, expect, it } from 'vitest';
import { endOfStudioDay } from './leads.service.js';

describe('endOfStudioDay', () => {
  it('is the next Beirut midnight, in winter (+2) and summer (+3)', () => {
    expect(endOfStudioDay(new Date('2026-11-06T10:00:00Z')).toISOString()).toBe(
      '2026-11-06T22:00:00.000Z',
    );
    expect(endOfStudioDay(new Date('2026-07-01T22:30:00Z')).toISOString()).toBe(
      '2026-07-02T21:00:00.000Z',
    );
  });
});
