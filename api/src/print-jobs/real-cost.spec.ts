import { describe, expect, it } from 'vitest';
import { realCostPerPiece } from './print-jobs.service.js';

describe('realCostPerPiece', () => {
  it('spreads every run (failed ones too) over the pieces printed', () => {
    expect(
      realCostPerPiece({
        done: 2,
        failed: 1,
        pieces: 4,
        grams: '250',
        hours: '10',
        material: '6.00',
        electricity: '1.00',
        wear: '1.00',
        sold: '60.00',
      }),
    ).toEqual({
      done: 2,
      failed: 1,
      pieces: 4,
      perPiece: {
        grams: '62.5',
        hours: '2.50',
        material: '1.50',
        electricity: '0.25',
        wear: '0.25',
        total: '2.00',
        soldAt: '15.00',
        margin: '13.00',
      },
    });
  });

  it('leaves the sales tax out of what customers paid', () => {
    const cost = realCostPerPiece(
      {
        done: 1,
        failed: 0,
        pieces: 1,
        grams: '10',
        hours: '1',
        material: '1.00',
        electricity: '0',
        wear: '0',
        sold: '11.00',
      },
      '10',
    );
    expect(cost.perPiece).toMatchObject({ soldAt: '10.00', margin: '9.00' });
  });

  it('has nothing per piece before a run is done', () => {
    expect(
      realCostPerPiece({
        done: 0,
        failed: 1,
        pieces: 0,
        grams: '20',
        hours: '1',
        material: '0.50',
        electricity: '0.10',
        wear: '0',
        sold: '0',
      }),
    ).toEqual({ done: 0, failed: 1, pieces: 0, perPiece: null });
  });
});
