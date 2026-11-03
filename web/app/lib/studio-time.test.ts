import { describe, expect, it } from 'vitest';
import { fromStudioInput, studioDay, studioInput } from './studio-time';

describe('studio time (Beirut)', () => {
  it('reads winter times as UTC+2 and summer times as UTC+3', () => {
    expect(fromStudioInput('2026-11-02T08:00')).toBe(
      '2026-11-02T06:00:00.000Z',
    );
    expect(fromStudioInput('2026-07-01T08:00')).toBe(
      '2026-07-01T05:00:00.000Z',
    );
  });

  it('shows the API time back as the same wall time', () => {
    for (const v of [
      '2026-11-02T08:00',
      '2026-07-01T23:30',
      '2026-03-29T12:00',
    ])
      expect(studioInput(fromStudioInput(v))).toBe(v);
  });

  it('takes a day as its midnight, and names the day a late-evening UTC time falls on', () => {
    expect(fromStudioInput('2026-11-02')).toBe('2026-11-01T22:00:00.000Z');
    expect(studioDay('2026-11-01T22:30:00.000Z')).toBe('2026-11-02');
  });

  it('passes something unreadable through for the DTO to refuse', () => {
    expect(fromStudioInput('tomorrow')).toBe('tomorrow');
  });
});
