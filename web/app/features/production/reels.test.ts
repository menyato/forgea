import { describe, expect, it } from 'vitest';
import { reelsOf } from './reels';

describe('reelsOf', () => {
  const reel = { id: 'w', material: 'PLA', colour: 'White' };

  it('names every reel picked for a 3MF line', () => {
    expect(
      reelsOf({
        reel,
        picked: [
          { material: 'PLA', colour: 'White' },
          { material: 'PLA', colour: 'Magenta' },
        ],
      }),
    ).toBe('PLA · White + PLA · Magenta');
  });

  it("names the run's own reel otherwise, or none yet", () => {
    expect(reelsOf({ reel, picked: [] })).toBe('PLA · White');
    expect(reelsOf({ reel: null, picked: [] })).toBeNull();
  });
});
