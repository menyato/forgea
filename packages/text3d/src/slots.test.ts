import { readFileSync } from 'node:fs';
import { Box3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildDesign,
  buildSlots,
  designProblem,
  faceAround,
  KEYCHAIN_SHAPES,
  type DesignSlot,
  FontSet,
  logoFromSvg,
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

/** A box's triangles (x, y, z per corner): its six faces, two triangles each. */
function boxTriangles(min: number[], max: number[]): number[] {
  const [x0, y0, z0] = min as [number, number, number];
  const [x1, y1, z1] = max as [number, number, number];
  const q = (a: number[], b: number[], c: number[], d: number[]) => [
    ...a,
    ...b,
    ...c,
    ...a,
    ...c,
    ...d,
  ];
  return [
    ...q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]), // top, facing +Z
    ...q([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]), // bottom
    ...q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]), // front, -Y
    ...q([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]),
    ...q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]),
    ...q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]),
  ];
}

describe('a slot kept on its face', () => {
  // The top of a small bar, 16 x 6 mm (as a brake caliper's top): a long name must not hang off.
  const placement = {
    origin: [8, 3, 4] as [number, number, number],
    normal: [0, 0, 1] as [number, number, number],
    up: [0, 1, 0] as [number, number, number],
  };
  const onTop: DesignSlot = { ...name, placement, heightMm: 4, maxWidthMm: 24 };

  it('records the flat area under the click, and only that face', () => {
    const face = faceAround(boxTriangles([0, 0, 0], [16, 6, 4]), placement)!;
    expect(face).toHaveLength(1);
    const zs = face[0]!.filter((_, i) => i % 3 === 2);
    expect(zs.every((z) => Math.abs(z - 4) < 1e-6)).toBe(true);
    const xs = face[0]!.filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeCloseTo(0, 1);
    expect(Math.max(...xs)).toBeCloseTo(16, 1);
  });

  it('leaves out a lower face beside it (a disc next to its caliper)', () => {
    const disc = boxTriangles([-40, -40, 0], [0, 40, 2.5]);
    const face = faceAround(
      [...boxTriangles([0, 0, 0], [16, 6, 4]), ...disc],
      placement,
    )!;
    const xs = face.flatMap((k) => k.filter((_, i) => i % 3 === 0));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-0.01);
  });

  it('makes a long name smaller until it sits inside the face', () => {
    const face = faceAround(boxTriangles([0, 0, 0], [16, 6, 4]), placement)!;
    const slot = { ...onTop, placement: { ...placement, face } };
    const choice = { name: { text: 'Abdullah' } };
    const [loose] = buildSlots(fonts, [onTop], choice, new Map());
    const [kept] = buildSlots(fonts, [slot], choice, new Map());
    const wide = new Box3().setFromBufferAttribute(
      loose!.geometry.getAttribute('position') as never,
    );
    expect(wide.max.x - wide.min.x).toBeGreaterThan(16);
    const box = new Box3().setFromBufferAttribute(
      kept!.geometry.getAttribute('position') as never,
    );
    expect(box.min.x).toBeGreaterThanOrEqual(0.5);
    expect(box.max.x).toBeLessThanOrEqual(15.5);
    expect(box.min.y).toBeGreaterThanOrEqual(0.5);
    expect(box.max.y).toBeLessThanOrEqual(5.5);
  });

  it('a name clicked near the edge of a narrow face moves to where it fits largest', () => {
    // A long bar, 40 x 8 mm, clicked 1 mm from its end: centred there it would be a speck.
    const bar = boxTriangles([0, 0, 0], [40, 8, 4]);
    const nearEnd = {
      ...placement,
      origin: [1, 4, 4] as [number, number, number],
    };
    const face = faceAround(bar, nearEnd)!;
    const slot = {
      ...onTop,
      placement: { ...nearEnd, face },
      heightMm: 5,
      maxWidthMm: 40,
    };
    const [built] = buildSlots(
      fonts,
      [slot],
      { name: { text: 'Name' } },
      new Map(),
    );
    const box = new Box3().setFromBufferAttribute(
      built!.geometry.getAttribute('position') as never,
    );
    expect(box.min.x).toBeGreaterThanOrEqual(0.5);
    expect(box.max.x - box.min.x).toBeGreaterThan(10);
  });

  it('turning the text keeps the face', () => {
    const face = faceAround(boxTriangles([0, 0, 0], [16, 6, 4]), placement)!;
    const turned = {
      ...onTop,
      placement: {
        ...placement,
        up: [1, 0, 0] as [number, number, number],
        face,
      },
    };
    const [kept] = buildSlots(
      fonts,
      [turned],
      { name: { text: 'Abdullah' } },
      new Map(),
    );
    const box = new Box3().setFromBufferAttribute(
      kept!.geometry.getAttribute('position') as never,
    );
    expect(box.max.y - box.min.y).toBeLessThanOrEqual(5);
  });
});

describe('raised or flush', () => {
  it('raised stands out of the surface; flush goes into it, its top level with it', () => {
    const top = {
      ...name,
      placement: {
        origin: [0, 0, 5] as [number, number, number],
        normal: [0, 0, 1] as [number, number, number],
        up: [0, 1, 0] as [number, number, number],
      },
    };
    const zOf = (slot: DesignSlot) => {
      const [b] = buildSlots(fonts, [slot], {}, new Map());
      return new Box3().setFromBufferAttribute(
        b!.geometry.getAttribute('position') as never,
      );
    };
    const raised = zOf({ ...top, depthMm: 1 });
    expect(raised.max.z).toBeCloseTo(6, 3);
    const flush = zOf({ ...top, depthMm: 1, relief: 'FLUSH' });
    expect(flush.min.z).toBeCloseTo(4, 3);
    expect(flush.max.z).toBeLessThan(5.05);
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
    const logos = new Map([['square', logoFromSvg(SQUARE_WITH_HOLE)]]);
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
    const logos = new Map([['square', logoFromSvg(SQUARE_WITH_HOLE)]]);
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

  it('a logo alone, no name: the logo raised on its plate, with the ring', () => {
    const logos = new Map([['square', logoFromSvg(SQUARE_WITH_HOLE)]]);
    const alone = { ...design, text: '', logoId: 'square' };
    expect(designProblem(fonts, alone, settings)).toBeNull();
    // Without a logo, a name is still needed.
    expect(designProblem(fonts, { ...design, text: '' }, settings)).toBe(
      'Type the text',
    );
    for (const shape of KEYCHAIN_SHAPES) {
      const built = buildDesign(fonts, { ...alone, shape }, settings, logos);
      expect(
        built.parts.find((p) => p.colour === 'white')!.volumeMm3,
      ).toBeGreaterThan(0);
      expect(
        built.parts.find((p) => p.colour === 'black')!.volumeMm3,
      ).toBeGreaterThan(0);
      // Twice the letters' height: a 20 mm logo.
      expect(built.size.y).toBeGreaterThan(20);
    }
  });
});

describe("a customer's own logo in a slot", () => {
  const place: DesignSlot = {
    id: 'logo',
    kind: 'LOGO',
    label: 'Your logo',
    editable: true,
    placement: { origin: [50, 0, 20], normal: [0, -1, 0], up: [0, 0, 1] },
    heightMm: 15,
    maxWidthMm: 40,
    depthMm: 1,
    colour: 'white',
    defaultOn: true,
  };
  const logos = new Map([['theirs', logoFromSvg(SQUARE_WITH_HOLE)]]);

  it('shows nothing until the customer adds theirs, then prints it', () => {
    expect(slotState(place, undefined).on).toBe(false);
    expect(buildSlots(fonts, [place], {}, logos)).toHaveLength(0);
    const built = buildSlots(
      fonts,
      [place],
      { logo: { logoId: 'theirs' } },
      logos,
    );
    expect(built).toHaveLength(1);
    expect(built[0]!.volumeMm3).toBeGreaterThan(0);
  });

  it('takes the place of the studio’s logo, and only where customers may change it', () => {
    const studio = { ...place, logoId: 'studio' };
    expect(slotState(studio, { logoId: 'theirs' }).logoId).toBe('theirs');
    expect(
      slotState({ ...studio, editable: false }, { logoId: 'theirs' }).logoId,
    ).toBe('studio');
  });
});
