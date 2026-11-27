import { describe, expect, it } from 'vitest';
import { sameFilament } from './order-filaments.service.js';

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
