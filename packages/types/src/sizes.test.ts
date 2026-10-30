import { describe, expect, it } from 'vitest';
import { scaledSize } from './sizes.js';

const base = {
  size: { x: '10.0', y: '8.0', z: '4.0' },
  grams: '60',
  printHours: '3',
};

describe('scaledSize', () => {
  it('keeps the proportions and scales grams and hours with the volume', () => {
    expect(scaledSize(base, 'x', 20)).toEqual({
      size: { x: '20.0', y: '16.0', z: '8.0' },
      grams: '480.00',
      printHours: '24.00',
    });
  });

  it('works from any axis, to one decimal', () => {
    expect(scaledSize(base, 'z', 3).size).toEqual({
      x: '7.5',
      y: '6.0',
      z: '3.0',
    });
  });

  it('refuses a size of zero', () => {
    expect(() => scaledSize(base, 'x', 0)).toThrow();
  });
});
