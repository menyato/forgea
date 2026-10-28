import { describe, expect, it } from 'vitest';
import {
  CUSTOM_REQUEST_STATUS_LABELS,
  isRequestExpired,
} from './custom-requests.js';
import { CustomRequestStatus } from './generated/prisma/enums.js';

describe('isRequestExpired', () => {
  const now = new Date('2026-10-27T12:00:00Z');

  it('expires a quote once its time has passed', () => {
    const past = '2026-10-27T11:59:59Z';
    expect(isRequestExpired(CustomRequestStatus.QUOTED, past, now)).toBe(true);
    expect(isRequestExpired(CustomRequestStatus.QUOTED, now, now)).toBe(true);
    expect(
      isRequestExpired(CustomRequestStatus.QUOTED, '2026-10-28T00:00:00Z', now),
    ).toBe(false);
  });

  it('never expires anything that is not waiting for an answer', () => {
    const past = '2020-01-01T00:00:00Z';
    for (const status of Object.values(CustomRequestStatus)) {
      if (status === CustomRequestStatus.QUOTED) continue;
      expect(isRequestExpired(status, past, now)).toBe(false);
    }
    expect(isRequestExpired(CustomRequestStatus.QUOTED, null, now)).toBe(false);
  });

  it('describes every status', () => {
    expect(Object.keys(CUSTOM_REQUEST_STATUS_LABELS).sort()).toEqual(
      Object.values(CustomRequestStatus).sort(),
    );
  });
});
