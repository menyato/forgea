import { describe, expect, it } from 'vitest';
import { overPicks, sameFilament } from './order-filaments.service.js';

describe('sameFilament', () => {
  const pla = { code: 'PLA', name: 'Elegoo PLA Matte' };
  const petg = { code: 'PETG', name: 'PETG' };

  it('takes a reel of the filament the file was sliced for', () => {
    expect(sameFilament('PLA', pla)).toBe(true);
    expect(sameFilament('PLA Matte', pla)).toBe(true);
    expect(sameFilament('petg', petg)).toBe(true);
  });

  it('refuses another filament', () => {
    expect(sameFilament('PLA', petg)).toBe(false);
    expect(sameFilament('PETG', pla)).toBe(false);
  });

  it('lets any reel print a file that does not say', () => {
    expect(sameFilament(null, petg)).toBe(true);
    expect(sameFilament(undefined, pla)).toBe(true);
  });
});

describe('overPicks', () => {
  const file = {
    colours: [
      { colour: 'White', hex: '#ffffff', grams: '9' },
      { colour: 'Pink', hex: '#ff00ff', grams: '2' },
    ],
  } as unknown as Parameters<typeof overPicks>[0];
  const picks = [
    { colour: 'White', id: 'w', reel: 'PLA White' },
    { colour: 'Pink', id: 'm', reel: 'PLA Magenta' },
  ];

  it('shares a run over the picked reels as the file does, in whole grams', () => {
    expect(overPicks(file, picks, 11)).toEqual([
      { reel: 'PLA White', grams: 9 },
      { reel: 'PLA Magenta', grams: 2 },
    ]);
    const split = overPicks(file, picks, 12);
    expect(split.reduce((n, s) => n + s.grams, 0)).toBe(12);
    expect(overPicks(file, picks, -3).every((s) => s.grams <= 0)).toBe(true);
  });

  it('adds colours printed from the same reel together', () => {
    expect(
      overPicks(
        file,
        [
          { colour: 'White', id: 'w', reel: 'W' },
          { colour: 'Pink', id: 'w', reel: 'W' },
        ],
        10,
      ),
    ).toEqual([{ reel: 'W', grams: 10 }]);
  });

  it('has nothing to share without a file or picks', () => {
    expect(overPicks(null, picks, 5)).toEqual([]);
    expect(overPicks(file, [], 5)).toEqual([]);
  });
});
