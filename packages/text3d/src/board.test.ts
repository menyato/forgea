import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { boardShapes } from './board.js';
import { type BoardItem, FontSet, type TextSettings } from './index.js';
import { layoutDesign } from './layout.js';
import { boundsOf, signedArea } from './outline.js';

const font = (file: string) =>
  new Uint8Array(
    readFileSync(
      new URL(`../../../api/prisma/example-fonts/${file}`, import.meta.url),
    ),
  );
let fonts: FontSet;
beforeAll(async () => {
  fonts = await FontSet.load([{ id: 'cairo', bytes: font('Cairo.ttf') }]);
});

const standing: TextSettings = {
  style: 'STANDING_INITIAL',
  maxChars: 12,
  letterHeightMm: 150,
  letterDepthMm: 2,
  baseDepthMm: 25,
  maxWidthMm: 200,
};
const item = (over: Partial<BoardItem>): BoardItem => ({
  id: 'i',
  kind: 'TEXT',
  text: 'Ayla',
  x: 0,
  y: 0,
  size: 25,
  rotation: 0,
  colour: 'pink',
  ...over,
});
const design = (items: BoardItem[]) => ({
  text: 'Ayla',
  fontId: 'cairo',
  textColour: 'beige',
  items,
});

describe('a piece designed freely (standing initial)', () => {
  it('stands on a flat bottom; the items sit on its face where they were placed, in their colours', () => {
    const name = item({ id: 'name', x: 0, y: 10 });
    const heart = item({
      id: 'heart',
      kind: 'MOTIF',
      motif: 'HEART',
      text: undefined,
      x: 40,
      y: 50,
      size: 15,
      colour: 'red',
    });
    const built = layoutDesign(fonts, design([name, heart]), standing);
    const base = built.parts.find((p) => p.colour === 'beige')!;
    expect(base.z0).toBe(0);
    expect(base.z1).toBe(25);
    const raised = built.parts.filter((p) => p.z0 === 25);
    expect(raised.map((p) => p.colour).sort()).toEqual(['pink', 'red']);
    expect(raised.every((p) => p.z1 === 27)).toBe(true);
    // The heart's centre is where it was put (from the base's centre).
    const shapes = boardShapes(fonts, design([name, heart]), standing);
    const hb = boundsOf(shapes.items.find((i) => i.id === 'heart')!.regions)!;
    expect((hb.minX + hb.maxX) / 2).toBeCloseTo(40, 0);
    expect((hb.minY + hb.maxY) / 2).toBeCloseTo(50, 0);
  });

  it('an item reaching past the letter gets a frame of the letter behind it, never below its foot', () => {
    const wide = item({
      id: 'wide',
      text: 'A very long name',
      size: 20,
      y: -10,
    });
    const shapes = boardShapes(fonts, design([wide]), standing);
    const letter = boundsOf(shapes.base)!;
    const text = boundsOf(shapes.items[0]!.regions)!;
    expect(text.maxX - text.minX).toBeGreaterThan(letter.maxX - letter.minX);
    const base = layoutDesign(fonts, design([wide]), standing).parts.find(
      (p) => p.colour === 'beige',
    )!;
    const frame = boundsOf(base.regions)!;
    // The frame holds the whole name, and the piece still stands on the letter's own bottom.
    expect(frame.minX).toBeLessThanOrEqual(text.minX);
    expect(frame.maxX).toBeGreaterThanOrEqual(text.maxX);
    expect(frame.minY).toBeGreaterThanOrEqual(letter.minY - 0.01);
  });

  it('something placed off the letter is joined to it by a stem: the piece prints as one', () => {
    const far = item({
      id: 'far',
      kind: 'MOTIF',
      motif: 'STAR',
      text: undefined,
      x: 95,
      y: 70,
      size: 12,
    });
    const base = layoutDesign(fonts, design([far]), standing).parts.find(
      (p) => p.colour === 'beige' && p.z0 === 0,
    )!;
    expect(base.regions).toHaveLength(1);
  });

  it("keeps a letter's hole, but fills what little of it things leave", () => {
    const a = { ...design([]), text: 'A' };
    const open = layoutDesign(fonts, a, standing).parts.find(
      (p) => p.z0 === 0,
    )!;
    expect(open.regions.some((r) => r.holes.length > 0)).toBe(true);
    // A name across the hole covers most of it: no stray dot is left.
    const covered = layoutDesign(
      fonts,
      { ...a, items: [item({ text: 'Lina', size: 30, y: 8 })] },
      standing,
    ).parts.find((p) => p.z0 === 0)!;
    for (const r of covered.regions)
      for (const hole of r.holes)
        expect(Math.abs(signedArea(hole))).toBeGreaterThanOrEqual(
          (150 * 0.07) ** 2,
        );
  });

  it('turns an item as asked', () => {
    const flat = boundsOf(
      boardShapes(fonts, design([item({ text: 'IIIII', size: 10 })]), standing)
        .items[0]!.regions,
    )!;
    const turned = boundsOf(
      boardShapes(
        fonts,
        design([item({ text: 'IIIII', size: 10, rotation: 90 })]),
        standing,
      ).items[0]!.regions,
    )!;
    expect(turned.maxY - turned.minY).toBeCloseTo(flat.maxX - flat.minX, 0);
  });

  it('a trophy is a plaque on a foot', () => {
    const trophy = {
      ...standing,
      style: 'TROPHY' as const,
      letterHeightMm: 120,
      baseDepthMm: 8,
    };
    const built = layoutDesign(
      fonts,
      design([item({ text: 'Best teacher', size: 12 })]),
      trophy,
    );
    const foot = built.parts.find((p) => p.z0 < 0)!;
    expect(foot.z1 - foot.z0).toBeGreaterThanOrEqual(40);
  });
});
