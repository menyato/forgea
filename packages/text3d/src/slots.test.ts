import { readFileSync } from 'node:fs';
import { Box3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildDesign,
  buildSlots,
  KEYCHAIN_SHAPES,
  type DesignSlot,
  FontSet,
  logoRegionsFromSvg,
  slotsProblem,
  slotState,
} from './index.js';
import { boundsOf } from './outline.js';
import { pathCommands } from './svg.js';

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

/** A name on the front of a box standing on the plate (front = facing -Y, as slicers show). */
const name: DesignSlot = {
  id: 'name',
  kind: 'TEXT',
  label: 'Name',
  editable: true,
  placement: { origin: [50, 0, 20], normal: [0, -1, 0], up: [0, 0, 1] },
  heightMm: 10,
  maxWidthMm: 60,
  depthMm: 1.2,
  colour: 'white',
  defaultText: 'Forgea',
  defaultFontId: 'cairo',
  maxChars: 12,
};

const SQUARE_WITH_HOLE =
  '<svg viewBox="0 0 100 100"><g transform="translate(10 10)"><path d="M0 0 H80 V80 H0 Z M20 20 v40 h40 v-40 z"/></g></svg>';

describe('logos from SVG', () => {
  it('reads paths, groups and their transforms, nested shapes as holes, scaled to 1', () => {
    const regions = logoRegionsFromSvg(SQUARE_WITH_HOLE);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.holes).toHaveLength(1);
    const b = boundsOf(regions)!;
    expect(b.maxX - b.minX).toBeCloseTo(1, 5);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(0, 5);
  });

  it('reads circles, rectangles and arcs, and refuses a file with nothing to draw', () => {
    const regions = logoRegionsFromSvg(
      '<svg><circle cx="50" cy="50" r="40"/><rect x="0" y="95" width="100" height="5"/><path d="M10 10 A 5 5 0 0 1 20 10 Z"/></svg>',
    );
    expect(regions.length).toBeGreaterThanOrEqual(2);
    expect(() => logoRegionsFromSvg('<svg><text>hi</text></svg>')).toThrow(
      /no shapes/,
    );
  });

  it('expands relative and shorthand path commands', () => {
    const cmds = pathCommands('m10 10 h10 v10 s5 5 10 0 t10 0 z');
    expect(cmds.map((c) => c.type).join('')).toBe('MLLCQZ');
    expect(cmds[1]!.values).toEqual([20, 10]);
  });
});

describe('slots on a model', () => {
  it('raises the default text on the face it was placed on, sized to its height', () => {
    const [built] = buildSlots(fonts, [name], {}, new Map());
    expect(built).toBeDefined();
    const box = new Box3().setFromBufferAttribute(
      built!.geometry.getAttribute('position') as never,
    );
    // Facing -Y: it stands out of the face toward -Y, from just inside the surface.
    expect(box.min.y).toBeCloseTo(-1.2, 1);
    expect(box.max.y).toBeCloseTo(0.4, 1);
    // Upright: its height runs along Z, about the letters' height, centred on the origin.
    expect(box.max.z - box.min.z).toBeGreaterThan(9);
    expect(box.max.z - box.min.z).toBeLessThan(14);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(50, 0);
    expect(built!.volumeMm3).toBeGreaterThan(0);
  });

  it('takes the customer’s text only where the owner lets them, and fits it to the width', () => {
    const long = { name: { text: 'A very long name here' } };
    const [fitted] = buildSlots(fonts, [name], long, new Map());
    const box = new Box3().setFromBufferAttribute(
      fitted!.geometry.getAttribute('position') as never,
    );
    expect(box.max.x - box.min.x).toBeLessThanOrEqual(60.01);
    expect(slotState({ ...name, editable: false }, long.name).text).toBe(
      'Forgea',
    );
  });

  it('shows a logo until turned off, and says what is wrong with a text', () => {
    const logo: DesignSlot = {
      ...name,
      id: 'logo',
      kind: 'LOGO',
      label: 'Logo',
      logoId: 'square',
      defaultOn: true,
    };
    const logos = new Map([['square', logoRegionsFromSvg(SQUARE_WITH_HOLE)]]);
    expect(buildSlots(fonts, [logo], {}, logos)).toHaveLength(1);
    expect(
      buildSlots(fonts, [logo], { logo: { on: false } }, logos),
    ).toHaveLength(0);
    expect(
      slotsProblem(fonts, [name], { name: { text: 'x'.repeat(13) } }),
    ).toMatch(/Name: At most 12/);
    expect(slotsProblem(fonts, [name], { name: { fontId: 'nope' } })).toMatch(
      /fonts offered/,
    );
    expect(slotsProblem(fonts, [name], {})).toBeNull();
  });
});

describe('keychain shapes and logo', () => {
  const settings = {
    style: 'KEYCHAIN' as const,
    maxChars: 12,
    letterHeightMm: 10,
    letterDepthMm: 1.6,
    baseDepthMm: 2.4,
    maxWidthMm: 120,
  };
  const design = {
    text: 'Sara',
    fontId: 'cairo',
    textColour: 'white',
    baseColour: 'black',
  };

  it('makes each shape one plate that holds the letters, with its ring', () => {
    for (const shape of KEYCHAIN_SHAPES) {
      const built = buildDesign(fonts, { ...design, shape }, settings);
      const plate = built.parts.find((p) => p.colour === 'black')!;
      expect(plate.volumeMm3).toBeGreaterThan(0);
      expect(built.size.x).toBeGreaterThan(30);
    }
    const oval = buildDesign(fonts, { ...design, shape: 'OVAL' }, settings);
    const outline = buildDesign(fonts, design, settings);
    // The oval goes round the letters' box: taller than a plate that follows them.
    expect(oval.size.y).toBeGreaterThan(outline.size.y);
  });

  it('puts the logo after the name, in the letters’ colour', () => {
    const logos = new Map([['square', logoRegionsFromSvg(SQUARE_WITH_HOLE)]]);
    const plain = buildDesign(fonts, design, settings, logos);
    const withLogo = buildDesign(
      fonts,
      { ...design, logoId: 'square' },
      settings,
      logos,
    );
    expect(withLogo.size.x).toBeGreaterThan(plain.size.x + 8);
    const letters = (b: typeof plain) =>
      b.parts
        .filter((p) => p.colour === 'white')
        .reduce((n, p) => n + p.volumeMm3, 0);
    expect(letters(withLogo)).toBeGreaterThan(letters(plain));
  });
});
