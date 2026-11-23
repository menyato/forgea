import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildDesign,
  coloursOf,
  designProblem,
  FontSet,
  fontScripts,
  logoFromSvg,
  stlBytes,
  TEXT_DECORS,
  type TextSettings,
  textProblem,
} from './index.js';
import { layoutDesign } from './layout.js';
import { boundsOf } from './outline.js';

/** The example fonts the seed loads (SIL Open Font License, in api/prisma/example-fonts). */
const font = (file: string) =>
  new Uint8Array(
    readFileSync(
      new URL(`../../../api/prisma/example-fonts/${file}`, import.meta.url),
    ),
  );

const keychain: TextSettings = {
  style: 'KEYCHAIN',
  maxChars: 12,
  letterHeightMm: 12,
  letterDepthMm: 2,
  baseDepthMm: 3,
  maxWidthMm: 90,
};

let fonts: FontSet;
beforeAll(async () => {
  fonts = await FontSet.load([
    { id: 'cairo', bytes: font('Cairo.ttf') },
    { id: 'pacifico', bytes: font('Pacifico.ttf') },
    { id: 'lalezar', bytes: font('Lalezar.ttf') },
    { id: 'ruqaa', bytes: font('ArefRuqaa.ttf') },
  ]);
});

describe('fonts', () => {
  it('knows which scripts a font writes, and its name', async () => {
    expect(await fontScripts(font('Cairo.ttf'))).toEqual({
      name: 'Cairo',
      latin: true,
      arabic: true,
    });
    expect(await fontScripts(font('Pacifico.ttf'))).toMatchObject({
      latin: true,
      arabic: false,
    });
  });
});

describe('designProblem', () => {
  it('accepts a name the font can write', () => {
    expect(
      designProblem(
        fonts,
        { text: 'Sara', fontId: 'pacifico', textColour: 'red' },
        keychain,
      ),
    ).toBeNull();
    expect(
      designProblem(
        fonts,
        { text: 'سارة', fontId: 'lalezar', textColour: 'red' },
        keychain,
      ),
    ).toBeNull();
  });

  it('names the letters a font lacks, and refuses mixed or odd text', () => {
    expect(
      designProblem(
        fonts,
        { text: 'سارة', fontId: 'pacifico', textColour: 'red' },
        keychain,
      ),
    ).toMatch(/This font has no .*choose another font/);
    expect(
      designProblem(
        fonts,
        { text: 'Sara سارة', fontId: 'cairo', textColour: 'red' },
        keychain,
      ),
    ).toMatch(/Arabic or English/);
    expect(
      designProblem(
        fonts,
        { text: '<b>', fontId: 'cairo', textColour: 'red' },
        keychain,
      ),
    ).toMatch(/letters, numbers/);
    expect(
      designProblem(
        fonts,
        { text: 'A very long name here', fontId: 'cairo', textColour: 'red' },
        keychain,
      ),
    ).toMatch(/At most 12/);
    expect(
      designProblem(
        fonts,
        { text: 'ABCD', fontId: 'cairo', textColour: 'red' },
        { ...keychain, style: 'MONOGRAM' },
      ),
    ).toMatch(/Up to 3 initials/);
  });
});

describe('layoutDesign', () => {
  it('a keychain: letters raised on one backing, a ring with a hole, two colours', () => {
    const layout = layoutDesign(
      fonts,
      {
        text: 'Mia Ali',
        fontId: 'cairo',
        textColour: 'red',
        baseColour: 'white',
      },
      keychain,
    );
    const backing = layout.parts.find((p) => p.colour === 'white')!;
    const letters = layout.parts.find((p) => p.colour === 'red')!;
    // Two words, one piece: the backing is a single region, its only hole the ring's.
    expect(backing.regions).toHaveLength(1);
    expect(backing.regions[0]!.holes.length).toBeGreaterThanOrEqual(1);
    expect([backing.z0, backing.z1]).toEqual([0, 3]);
    expect([letters.z0, letters.z1]).toEqual([3, 5]);
    expect(layout.size.z).toBe(5);
    expect(layout.size.x).toBeLessThanOrEqual(90.01);
  });

  it('keeps the dots of i and j, and of Arabic letters, on the piece', () => {
    for (const [text, fontId] of [
      ['jiji', 'pacifico'],
      ['بنت', 'lalezar'],
    ] as const) {
      const layout = layoutDesign(
        fonts,
        { text, fontId, textColour: 'red', baseColour: 'white' },
        { ...keychain, style: 'NAME' },
      );
      expect(
        layout.parts.find((p) => p.colour === 'white')!.regions,
      ).toHaveLength(1);
    }
  });

  it('puts the ring at the start: the left for English, the right for Arabic', () => {
    const ringSide = (text: string, fontId: string) => {
      const layout = layoutDesign(
        fonts,
        { text, fontId, textColour: 'red' },
        keychain,
      );
      const backing = layout.parts.find((p) => p.z0 === 0)!.regions[0]!;
      const hole = backing.holes[0]!;
      const holeX = hole.reduce((s, [x]) => s + x, 0) / hole.length;
      return holeX < layout.size.x / 2 ? 'left' : 'right';
    };
    expect(ringSide('Sara', 'cairo')).toBe('left');
    expect(ringSide('سارة', 'cairo')).toBe('right');
  });

  it('a standing name and curved initials stand on a foot, in the backing colour', () => {
    for (const style of ['NAME', 'MONOGRAM'] as const) {
      const layout = layoutDesign(
        fonts,
        {
          text: style === 'NAME' ? 'Maya' : 'SAM',
          fontId: 'cairo',
          textColour: 'red',
          baseColour: 'black',
        },
        {
          ...keychain,
          style,
          letterHeightMm: 30,
          letterDepthMm: 5,
          baseDepthMm: 3,
        },
      );
      const foot = layout.parts.find((p) => p.colour === 'black' && p.z0 < 0)!;
      expect(foot, style).toBeDefined();
      // Deeper than the piece is thick, centred on it: it doesn't tip over.
      expect(foot.z1 - foot.z0).toBeGreaterThanOrEqual(12);
      expect(layout.size.z).toBeCloseTo(foot.z1 - foot.z0, 5);
      // The backing stays one piece above it.
      const backing = layout.parts.find(
        (p) => p.colour === 'black' && p.z0 === 0,
      )!;
      expect(backing.regions).toHaveLength(1);
    }
  });

  it('scales long text down to the widest the piece may be', () => {
    const layout = layoutDesign(
      fonts,
      { text: 'Alexandrina', fontId: 'cairo', textColour: 'red' },
      { ...keychain, maxWidthMm: 50 },
    );
    expect(layout.size.x).toBeLessThanOrEqual(50.01);
  });

  it('curved initials: each letter its own font and colour, all one piece', () => {
    const design = {
      text: 'AMK',
      fontId: 'cairo',
      textColour: 'red',
      baseColour: 'black',
      letters: [
        { fontId: 'pacifico', colour: 'gold' },
        { fontId: 'lalezar' },
        { colour: 'blue' },
      ],
    };
    const settings = { ...keychain, style: 'MONOGRAM' as const };
    const layout = layoutDesign(fonts, design, settings);
    expect(new Set(layout.parts.map((p) => p.colour))).toEqual(
      new Set(['black', 'gold', 'red', 'blue']),
    );
    expect(coloursOf(design, 'MONOGRAM').sort()).toEqual([
      'black',
      'blue',
      'gold',
      'red',
    ]);
    expect(
      layout.parts.find((p) => p.colour === 'black')!.regions,
    ).toHaveLength(1);
  });

  it('a big initial with the name across it and decorations: one standing piece in three colours', () => {
    const settings: TextSettings = {
      ...keychain,
      style: 'INITIAL_NAME',
      letterHeightMm: 80,
      letterDepthMm: 4,
      baseDepthMm: 3,
      maxWidthMm: 200,
    };
    for (const decor of TEXT_DECORS) {
      for (const [text, fontId] of [
        ['Lina', 'pacifico'],
        ['Jad', 'pacifico'],
        ['Ivy', 'pacifico'],
        ['ليلى', 'cairo'],
      ] as const) {
        const design = {
          text,
          fontId,
          accentFontId: 'lalezar',
          textColour: 'copper',
          accentColour: 'white',
          baseColour: 'black',
        };
        const label = `${decor} ${text}`;
        expect(
          designProblem(fonts, design, { ...settings, decor }),
          label,
        ).toBeNull();
        const layout = layoutDesign(fonts, design, { ...settings, decor });
        expect(new Set(layout.parts.map((p) => p.colour)), label).toEqual(
          new Set(['copper', 'white', 'black']),
        );
        // Decorations and name all held by one backing, on a foot.
        const backing = layout.parts.find(
          (p) => p.colour === 'black' && p.z0 === 0,
        )!;
        expect(backing.regions, label).toHaveLength(1);
        expect(
          layout.parts.some((p) => p.colour === 'black' && p.z0 < 0),
          label,
        ).toBe(true);
        expect(layout.size.y, label).toBeGreaterThan(80);
      }
    }
    expect(
      coloursOf(
        { text: 'Lina', fontId: 'f', textColour: 'a', accentColour: 'b' },
        'INITIAL_NAME',
      ),
    ).toEqual(['a', 'b']);
  });

  it('the name is cut free of the initial, so it reads even in one colour', () => {
    const settings: TextSettings = {
      ...keychain,
      style: 'INITIAL_NAME',
      letterHeightMm: 80,
      maxWidthMm: 200,
      decor: 'STARS',
    };
    const one = layoutDesign(
      fonts,
      { text: 'Omar', fontId: 'pacifico', textColour: 'copper' },
      settings,
    );
    const raised = one.parts.find((p) => p.z0 > 0)!;
    // The initial, its decorations and the name stay separate shapes on the backing.
    expect(raised.regions.length).toBeGreaterThan(4);
  });

  it('two names with a heart between them; Arabic puts the first name on the right', () => {
    const settings: TextSettings = {
      ...keychain,
      style: 'COUPLE',
      maxChars: 10,
      letterHeightMm: 30,
      maxWidthMm: 250,
    };
    expect(textProblem('Sara', settings)).toBe('Type both names');
    expect(textProblem('Sara & ', settings)).toBe('Type both names');
    expect(textProblem('Alexandrina & Ali', settings)).toBe(
      'At most 10 characters in each name',
    );
    expect(textProblem('Sara & Ali', settings)).toBeNull();
    const design = {
      text: 'Sara & Ali',
      fontId: 'pacifico',
      textColour: 'copper',
      accentColour: 'red',
      baseColour: 'black',
    };
    expect(designProblem(fonts, design, settings)).toBeNull();
    const layout = layoutDesign(fonts, design, settings);
    expect(new Set(layout.parts.map((p) => p.colour))).toEqual(
      new Set(['copper', 'red', 'black']),
    );
    expect(
      layout.parts.find((p) => p.colour === 'black' && p.z0 === 0)!.regions,
    ).toHaveLength(1);
    // The heart sits in the middle.
    const heart = boundsOf(
      layout.parts.find((p) => p.colour === 'red')!.regions,
    )!;
    const mid = (heart.minX + heart.maxX) / 2;
    expect(Math.abs(mid - layout.size.x / 2)).toBeLessThan(
      layout.size.x * 0.15,
    );

    const lettersX = (text: string) => {
      const l = layoutDesign(
        fonts,
        { ...design, fontId: 'cairo', text },
        settings,
      );
      return boundsOf(l.parts.find((p) => p.colour === 'copper')!.regions)!;
    };
    // "سارة & علي": سارة (wider) on the right, so the letters reach further right of centre.
    const ar = lettersX('سارة & لي');
    const width = ar.maxX - ar.minX;
    expect(width).toBeGreaterThan(0);
    const longFirst = layoutDesign(
      fonts,
      { ...design, fontId: 'cairo', text: 'سارةسارة & لي' },
      settings,
    );
    const h2 = boundsOf(
      longFirst.parts.find((p) => p.colour === 'red')!.regions,
    )!;
    // The long first name is on the right: the heart is left of centre.
    expect((h2.minX + h2.maxX) / 2).toBeLessThan(longFirst.size.x / 2);
  });

  it('single letters: each its own piece', () => {
    const layout = layoutDesign(
      fonts,
      { text: 'AB', fontId: 'cairo', textColour: 'red', baseColour: 'white' },
      { ...keychain, style: 'LETTERS' },
    );
    expect(
      layout.parts.find((p) => p.colour === 'white')!.regions,
    ).toHaveLength(2);
  });
});

describe('buildDesign', () => {
  it('gives each colour a solid with its volume, fast enough to price on every change', () => {
    const started = performance.now();
    const built = buildDesign(
      fonts,
      {
        text: 'Forgea',
        fontId: 'cairo',
        textColour: 'red',
        baseColour: 'white',
      },
      keychain,
    );
    expect(performance.now() - started).toBeLessThan(1000);
    expect(built.parts).toHaveLength(2);
    for (const p of built.parts) expect(p.volumeMm3).toBeGreaterThan(100);
    // The backing (3 mm) holds more than the letters (2 mm, smaller area).
    const [backing, letters] = [
      built.parts.find((p) => p.colour === 'white')!,
      built.parts.find((p) => p.colour === 'red')!,
    ];
    expect(backing.volumeMm3).toBeGreaterThan(letters.volumeMm3);
    const stl = stlBytes(backing.geometry, 'backing');
    const triangles = new DataView(stl.buffer).getUint32(80, true);
    expect(stl.byteLength).toBe(84 + triangles * 50);
    expect(triangles).toBeGreaterThan(100);
  });
});

describe('a logo in its own colours', () => {
  const logo = logoFromSvg(
    '<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#0033aa"/><circle cx="50" cy="50" r="25" fill="#ffffff"/></svg>',
  );
  const logos = new Map([['badge', logo]]);
  const design = {
    text: 'Sam',
    fontId: 'cairo',
    textColour: 'gold',
    baseColour: 'black',
    logoId: 'badge',
  };

  it('prints in the letters colour unless colours are chosen', () => {
    const built = buildDesign(fonts, design, keychain, logos);
    expect(built.parts.map((p) => p.colour).sort()).toEqual(['black', 'gold']);
  });

  it('prints each of its colours in the filament chosen for it', () => {
    const built = buildDesign(
      fonts,
      { ...design, logoColours: ['navy', 'white'] },
      keychain,
      logos,
    );
    const colours = built.parts.map((p) => p.colour).sort();
    expect(colours).toEqual(['black', 'gold', 'navy', 'white']);
    const navy = built.parts.find((p) => p.colour === 'navy')!.volumeMm3;
    const white = built.parts.find((p) => p.colour === 'white')!.volumeMm3;
    // The white disc lies on the badge: the badge keeps the rest of the square.
    expect(white).toBeGreaterThan(0);
    expect(navy).toBeGreaterThan(white);
    expect(
      coloursOf({ ...design, logoColours: ['navy', 'white'] }, 'KEYCHAIN'),
    ).toEqual(['gold', 'black', 'navy', 'white']);
  });
});

describe('keychain ring', () => {
  it('is joined to a heart plate (one piece with it)', () => {
    for (const text of ['Sara', 'Al', 'Maximilian']) {
      const layout = layoutDesign(
        fonts,
        {
          text,
          fontId: 'pacifico',
          textColour: 'w',
          baseColour: 'r',
          shape: 'HEART',
        },
        keychain,
      );
      const plate = layout.parts.filter((p) => p.colour === 'r');
      expect(plate).toHaveLength(1);
      expect(plate[0]!.regions).toHaveLength(1);
    }
  });
});
