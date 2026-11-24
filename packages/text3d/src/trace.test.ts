import { describe, expect, it } from 'vitest';
import { nearestColour } from './design.js';
import { logoFromSvg, logoRegionsFromSvg } from './svg.js';
import { area, inkMask, traceLogoSvg, traceLoops, traceSvg } from './trace.js';

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

  it('a translucent part of a transparent logo is part of it', () => {
    // A solid square, a 40% opaque one beside it, faint edge haze around: two squares count.
    const px = picture(
      12,
      12,
      (x, y) => y > 2 && y < 6 && x > 1 && x < 5,
      [238, 240, 241, 255],
      [0, 0, 0, 0],
    );
    for (let y = 3; y < 6; y++)
      for (let x = 6; x < 9; x++) px.set([50, 55, 60, 102], (y * 12 + x) * 4);
    for (let x = 0; x < 12; x++) px.set([0, 0, 0, 10], (10 * 12 + x) * 4);
    expect(inkMask(px, 12, 12).reduce((n, v) => n + v, 0)).toBe(18);
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

describe('traceLogoSvg', () => {
  /** A blue badge with a red square on it and a white ring of paper around. */
  const w = 60;
  const px = new Uint8Array(w * w * 4);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const badge = x >= 10 && x < 50 && y >= 10 && y < 50;
      const mark = x >= 22 && x < 38 && y >= 22 && y < 38;
      px.set(
        mark
          ? [220, 30, 30, 255]
          : badge
            ? [20, 60, 200, 255]
            : [255, 255, 255, 255],
        (y * w + x) * 4,
      );
    }

  it('keeps the logo whole as its outline and each colour as its own area', () => {
    const svg = traceLogoSvg(px, w, w)!;
    expect(svg).toContain('data-inks');
    const logo = logoFromSvg(svg);
    // The outline is the whole badge: the red square is not a hole in it.
    expect(logo.outline).toHaveLength(1);
    expect(logo.outline[0]!.holes).toHaveLength(0);
    expect(logo.inks!.map((i) => i.hex)).toEqual(['#143cc8', '#dc1e1e']);
    // The blue is the badge around the red square.
    expect(logo.inks![0]!.regions[0]!.holes).toHaveLength(1);
  });

  it('a logo in one colour has no colours of its own', () => {
    const plain = new Uint8Array(px);
    for (let i = 0; i < plain.length; i += 4)
      if (plain[i] === 220) plain.set([20, 60, 200, 255], i);
    const svg = traceLogoSvg(plain, w, w)!;
    expect(svg).not.toContain('data-inks');
    expect(logoFromSvg(svg).inks).toBeNull();
  });

  it('a chrome logo is two colours: its silver shading is one, its dark lettering another', () => {
    // A star in bands of silver (as chrome is drawn) beside dark navy and graphite lettering.
    const cw = 80;
    const chrome = new Uint8Array(cw * cw * 4);
    for (let y = 0; y < cw; y++)
      for (let x = 0; x < cw; x++) {
        const star = x >= 4 && x < 36 && y >= 10 && y < 70;
        const text = x >= 44 && x < 76 && y >= 10 && y < 70;
        const silver = [242, 214, 198, 225][Math.floor((y - 10) / 15)] ?? 255;
        chrome.set(
          star
            ? [silver, silver, silver + 2, 255]
            : text
              ? y < 40
                ? [14, 20, 31, 255]
                : [64, 72, 79, 255]
              : [255, 255, 255, 255],
          (y * cw + x) * 4,
        );
      }
    const logo = logoFromSvg(traceLogoSvg(chrome, cw, cw)!);
    expect(logo.inks).toHaveLength(2);
  });
});

describe('logoFromSvg', () => {
  it('reads each fill as a colour, later shapes covering earlier ones', () => {
    const logo = logoFromSvg(
      '<svg viewBox="0 0 100 100"><g fill="#0033aa"><rect x="0" y="0" width="100" height="100"/></g>' +
        '<circle cx="50" cy="50" r="20" style="fill: rgb(255, 255, 255)"/>' +
        '<rect x="90" y="90" width="1" height="1" fill="red"/></svg>',
    );
    // The red speck is too small to print in a colour of its own: it joins the closest.
    expect(logo.inks!.map((i) => i.hex)).toEqual(['#0033aa', '#ffffff']);
    expect(logo.inks![0]!.regions[0]!.holes.length).toBeGreaterThan(0);
    // As before, a shape inside another cuts it in the one-colour outline.
    expect(logo.outline[0]!.holes.length).toBeGreaterThan(0);
  });
});

describe('nearestColour', () => {
  const shop = [
    { id: 'black', swatchHex: '#161616' },
    { id: 'white', swatchHex: '#F4F4F2' },
    { id: 'silver', swatchHex: '#A8A9AD' },
    { id: 'blue', swatchHex: '#1F5FBF' },
    { id: 'gold', swatchHex: '#D4A72C' },
    { id: 'none', swatchHex: null },
  ];
  const pick = (hex: string) => nearestColour(hex, shop)?.id;

  it('prints a coloured part in a colour and a grey one in a neutral', () => {
    expect(pick('#4197c2')).toBe('blue'); // a light sky blue
    expect(pick('#575f63')).toBe('silver'); // a chrome grey
    expect(pick('#040404')).toBe('black');
    expect(pick('#ebeded')).toBe('white');
    expect(pick('#c8a040')).toBe('gold');
  });

  it('takes any colour when the shop has none of that kind', () => {
    expect(
      nearestColour('#ff0000', [{ id: 'black', swatchHex: '#000000' }])?.id,
    ).toBe('black');
    expect(nearestColour('#ff0000', [{ swatchHex: null }])).toBeNull();
  });
});
