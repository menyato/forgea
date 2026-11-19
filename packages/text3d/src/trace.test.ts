import { describe, expect, it } from 'vitest';
import { logoRegionsFromSvg } from './svg.js';
import { area, inkMask, traceLoops, traceSvg } from './trace.js';

/** A w x h mask from rows of '#' (logo) and '.' (background). */
function mask(rows: string[]): { m: Uint8Array; w: number; h: number } {
  const h = rows.length;
  const w = rows[0]!.length;
  const m = new Uint8Array(w * h);
  rows.forEach((r, y) =>
    [...r].forEach((c, x) => (m[y * w + x] = c === '#' ? 1 : 0)),
  );
  return { m, w, h };
}

/** RGBA pixels: `ink` where the predicate holds, else `paper`. */
function picture(
  w: number,
  h: number,
  isInk: (x: number, y: number) => boolean,
  ink: number[],
  paper: number[],
): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      px.set(isInk(x, y) ? ink : paper, (y * w + x) * 4);
  return px;
}

describe('traceLoops', () => {
  it('follows a square as one outline of its corners', () => {
    const { m, w, h } = mask(['....', '.##.', '.##.', '....']);
    const loops = traceLoops(m, w, h);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(4);
    expect(Math.abs(area(loops[0]!))).toBe(4);
  });

  it('a ring gives its outline and its hole, turning opposite ways', () => {
    const { m, w, h } = mask(['#####', '#...#', '#...#', '#...#', '#####']);
    const loops = traceLoops(m, w, h);
    expect(loops).toHaveLength(2);
    const [a, b] = loops.map(area);
    expect(Math.sign(a!)).toBe(-Math.sign(b!));
    expect(Math.abs(a!) + Math.abs(b!)).toBe(25 + 9);
  });

  it('pixels touching only at a corner stay two shapes', () => {
    const { m, w, h } = mask(['#.', '.#']);
    expect(traceLoops(m, w, h)).toHaveLength(2);
  });
});

describe('inkMask', () => {
  it('a dark logo on white paper: the dark pixels', () => {
    const px = picture(
      10,
      10,
      (x, y) => x > 2 && x < 7 && y > 2 && y < 7,
      [20, 20, 20, 255],
      [250, 250, 250, 255],
    );
    const m = inkMask(px, 10, 10);
    expect(m.reduce((n, v) => n + v, 0)).toBe(16);
    expect(m[0]).toBe(0);
  });

  it('a light logo on a dark background: the light pixels', () => {
    const px = picture(
      10,
      10,
      (x, y) => x > 2 && x < 7 && y > 2 && y < 7,
      [240, 240, 240, 255],
      [10, 10, 60, 255],
    );
    expect(inkMask(px, 10, 10).reduce((n, v) => n + v, 0)).toBe(16);
  });

  it('every part of a logo counts, a pale letter on white too', () => {
    // A near-white square (#EEF0F2) and a grey one on white paper: both are the logo.
    const px = picture(
      12,
      12,
      (x, y) => y > 2 && y < 9 && x > 1 && x < 10,
      [238, 240, 242, 255],
      [254, 254, 254, 255],
    );
    for (let y = 3; y < 9; y++)
      for (let x = 6; x < 10; x++)
        px.set([175, 176, 178, 255], (y * 12 + x) * 4);
    expect(inkMask(px, 12, 12).reduce((n, v) => n + v, 0)).toBe(48);
  });

  it('JPEG-like noise in the background is not the logo', () => {
    const px = picture(
      20,
      20,
      (x, y) => x > 6 && x < 13 && y > 6 && y < 13,
      [30, 30, 30, 255],
      [250, 250, 250, 255],
    );
    for (let i = 0; i < 400; i += 7) px[i * 4] = 243;
    expect(inkMask(px, 20, 20).reduce((n, v) => n + v, 0)).toBe(36);
  });

  it('a transparent PNG: the opaque pixels, whatever their colour', () => {
    const px = picture(
      10,
      10,
      (x, y) => x < 5 && y < 5,
      [255, 255, 255, 255],
      [0, 0, 0, 0],
    );
    expect(inkMask(px, 10, 10).reduce((n, v) => n + v, 0)).toBe(25);
  });
});

describe('traceSvg', () => {
  it('a traced picture reads back as print outlines, holes cut', () => {
    // A 40 x 40 ring (a letter O): outside 30 across, hole 14 across.
    const w = 40;
    const px = picture(
      w,
      w,
      (x, y) => {
        const d = Math.hypot(x + 0.5 - 20, y + 0.5 - 20);
        return d <= 15 && d >= 7;
      },
      [0, 0, 0, 255],
      [255, 255, 255, 255],
    );
    const svg = traceSvg(inkMask(px, w, w), w, w)!;
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 40 40"/);
    const regions = logoRegionsFromSvg(svg);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.holes).toHaveLength(1);
  });

  it('nothing but specks: no logo', () => {
    const { m, w, h } = mask([
      '#.........',
      '..........',
      '..........',
      '..........',
      '..........',
      '..........',
      '..........',
      '..........',
      '..........',
      '..........',
    ]);
    expect(traceSvg(m, w, h)).toBeNull();
  });
});
