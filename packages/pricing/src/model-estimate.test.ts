import { describe, expect, it } from 'vitest';
import { PricingError } from './errors.js';
import {
  estimatePrint,
  meshVolume,
  priceRange,
  stlPositions,
  stlTriangleCount,
} from './model-estimate.js';

/** A 10 mm cube as 12 outward-facing triangles. */
function cube(size: number): number[] {
  const v = (x: number, y: number, z: number) => [x * size, y * size, z * size];
  const quads = [
    [v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)],
    [v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)],
    [v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)],
    [v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)],
    [v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)],
    [v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)],
  ];
  return quads.flatMap(([a, b, c, d]) => [a!, b!, c!, a!, c!, d!].flat());
}

describe('meshVolume', () => {
  it('measures a closed mesh exactly, whichever way its triangles face', () => {
    expect(meshVolume(cube(10))).toBeCloseTo(1000);
    expect(meshVolume(new Float32Array(cube(20)))).toBeCloseTo(8000);
    const inward = cube(10);
    for (let i = 0; i < inward.length; i += 9)
      inward.splice(
        i + 3,
        6,
        ...inward.slice(i + 6, i + 9),
        ...inward.slice(i + 3, i + 6),
      );
    expect(meshVolume(inward)).toBeCloseTo(1000);
  });

  it('rejects positions that are not whole triangles', () => {
    expect(() => meshVolume([0, 0, 0, 1])).toThrow(PricingError);
  });
});

describe('estimatePrint', () => {
  const pla = {
    densityGPerCm3: '1.24',
    solidityPercent: '40',
    gramsPerHour: '12',
  };

  it('suggests grams from volume × density × solidity, and hours from throughput', () => {
    // 100 cm³ × 1.24 g/cm³ × 40% = 49.6 g; 49.6 g ÷ 12 g/h = 4.1333… → 4.14 h (rounded up)
    expect(estimatePrint({ volumeMm3: 100_000, ...pla })).toEqual({
      grams: '49.6',
      printHours: '4.14',
    });
  });

  it.each([
    [{ volumeMm3: -1 }, 'volume must not be negative'],
    [{ densityGPerCm3: '-1' }, 'density must not be negative'],
    [{ solidityPercent: 120 }, 'solidity must be between 0 and 100'],
    [{ gramsPerHour: 0 }, 'grams per hour must be greater than 0'],
  ])('rejects impossible inputs (%#)', (override, message) => {
    expect(() =>
      estimatePrint({ volumeMm3: 1000, ...pla, ...override }),
    ).toThrow(message);
  });
});

describe('stlPositions', () => {
  /** A binary STL of one triangle. */
  function binary(tris: number[][]): Uint8Array {
    const buf = new ArrayBuffer(84 + tris.length * 50);
    const view = new DataView(buf);
    view.setUint32(80, tris.length, true);
    tris.forEach((t, i) =>
      t.forEach((v, k) => view.setFloat32(84 + i * 50 + 12 + k * 4, v, true)),
    );
    return new Uint8Array(buf);
  }
  const tetra = [
    [0, 0, 0, 0, 10, 0, 10, 0, 0],
    [0, 0, 0, 10, 0, 0, 0, 0, 10],
    [0, 0, 0, 0, 0, 10, 0, 10, 0],
    [10, 0, 0, 0, 10, 0, 0, 0, 10],
  ];

  it('reads binary STL, giving the volume of the solid', () => {
    const positions = stlPositions(binary(tetra));
    expect(positions).toHaveLength(36);
    expect(meshVolume(positions)).toBeCloseTo(1000 / 6, 3);
  });

  it('reads ASCII STL', () => {
    const ascii = `solid t\n${tetra
      .map(
        (t) =>
          `facet normal 0 0 0\nouter loop\n${[0, 3, 6]
            .map((i) => `vertex ${t[i]} ${t[i + 1]} ${t[i + 2]}`)
            .join('\n')}\nendloop\nendfacet`,
      )
      .join('\n')}\nendsolid t`;
    const positions = stlPositions(new TextEncoder().encode(ascii));
    expect(meshVolume(positions)).toBeCloseTo(1000 / 6, 3);
  });

  it('refuses anything else', () => {
    expect(() => stlPositions(new TextEncoder().encode('hello'))).toThrow(
      PricingError,
    );
    expect(() =>
      stlPositions(new TextEncoder().encode('vertex 1 2 x')),
    ).toThrow(PricingError);
    // Not whole triangles, or a vertex line that can't be read.
    for (const text of ['vertex 1 2 3', 'vertex 1 2 3\nvertex']) {
      expect(() => stlPositions(new TextEncoder().encode(text))).toThrow(
        PricingError,
      );
    }
  });

  it('counts triangles without reading them, binary or ASCII', () => {
    expect(stlTriangleCount(binary(tetra))).toBe(4);
    const ascii = tetra
      .map((t) =>
        [0, 3, 6]
          .map((i) => `vertex ${t[i]} ${t[i + 1]} ${t[i + 2]}`)
          .join('\n'),
      )
      .join('\n');
    expect(stlTriangleCount(new TextEncoder().encode(ascii))).toBe(4);
    expect(stlTriangleCount(new Uint8Array(10))).toBe(0);
  });
});

describe('priceRange', () => {
  it('spreads around the price and widens to whole dollars', () => {
    expect(priceRange('20.00', 20)).toEqual({ low: '16.00', high: '24.00' });
    expect(priceRange('13.91', 20)).toEqual({ low: '11.00', high: '17.00' });
  });

  it('is the price itself (to whole dollars) with no spread', () => {
    expect(priceRange('7.5', 0)).toEqual({ low: '7.00', high: '8.00' });
  });

  it('refuses a spread over 100%', () => {
    expect(() => priceRange('10', 101)).toThrow(PricingError);
  });
});
