import { describe, expect, it } from 'vitest';
import {
  bucketStarts,
  daysIn,
  granularityFor,
  isCalendarDay,
  percentChange,
  periodError,
  presetOf,
  presetRange,
  previousRange,
} from './insights.js';

describe('periods', () => {
  const today = '2026-10-31';

  it('turns presets into dates up to today', () => {
    expect(presetRange('this-month', today)).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(presetRange('last-month', today)).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(presetRange('last-3-months', today)).toEqual({
      from: '2026-08-01',
      to: '2026-10-31',
    });
    expect(presetRange('this-year', today)).toEqual({
      from: '2026-01-01',
      to: '2026-10-31',
    });
    // January: last month is December of the year before.
    expect(presetRange('last-month', '2027-01-15')).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
  });

  it('recognises a preset, or none', () => {
    expect(presetOf({ from: '2026-09-01', to: '2026-09-30' }, today)).toBe(
      'last-month',
    );
    expect(
      presetOf({ from: '2026-09-02', to: '2026-09-30' }, today),
    ).toBeNull();
  });

  it('compares with the period of the same length just before', () => {
    expect(daysIn({ from: '2026-10-01', to: '2026-10-31' })).toBe(31);
    expect(previousRange({ from: '2026-10-01', to: '2026-10-31' })).toEqual({
      from: '2026-08-31',
      to: '2026-09-30',
    });
    expect(previousRange({ from: '2026-10-31', to: '2026-10-31' })).toEqual({
      from: '2026-10-30',
      to: '2026-10-30',
    });
  });

  it('groups by day, week or month with the length', () => {
    expect(granularityFor({ from: '2026-10-01', to: '2026-10-31' })).toBe(
      'day',
    );
    expect(granularityFor({ from: '2026-08-01', to: '2026-10-31' })).toBe(
      'week',
    );
    expect(granularityFor({ from: '2026-01-01', to: '2026-10-31' })).toBe(
      'month',
    );
  });

  it('lists bars the way date_trunc starts them', () => {
    expect(
      bucketStarts({ from: '2026-10-30', to: '2026-11-01' }, 'day'),
    ).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
    // 2026-10-01 is a Thursday: its week starts on Monday 28 September.
    expect(
      bucketStarts({ from: '2026-10-01', to: '2026-10-12' }, 'week'),
    ).toEqual(['2026-09-28', '2026-10-05', '2026-10-12']);
    expect(
      bucketStarts({ from: '2026-11-15', to: '2027-01-02' }, 'month'),
    ).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
  });

  it('explains what is wrong with a period', () => {
    expect(periodError(undefined, undefined)).toBeNull();
    expect(periodError('2026-10-01', '2026-10-31')).toBeNull();
    expect(periodError('2026-10-01', undefined)).toBe('Choose both dates');
    expect(periodError(undefined, '2026-10-01')).toBe('Choose both dates');
    expect(periodError('2026-02-30', '2026-03-01')).toBe('Enter real dates');
    expect(periodError('2026-10-31', '2026-10-01')).toBe(
      'The start date must be before the end date',
    );
    expect(periodError('2024-01-01', '2026-01-01')).toBe(
      'Choose a period of two years at most',
    );
    expect(periodError('2024-01-02', '2026-01-01')).toBeNull();
    expect(isCalendarDay('2026-1-01')).toBe(false);
  });

  it('gives the change in percent, or none without a past figure', () => {
    expect(percentChange('150.00', '100.00')).toBe(50);
    expect(percentChange(1, 3)).toBe(-66.7);
    expect(percentChange('-50', '-100')).toBe(50);
    expect(percentChange('10', '0')).toBeNull();
  });
});
