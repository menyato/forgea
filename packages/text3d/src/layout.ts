import { boardLayout } from './board.js';
import { difference, grown, union } from './clip.js';
import {
  BOARD_STYLES,
  coupleNames,
  isArabic,
  lettersOf,
  type LogoShape,
  STANDING_STYLES,
  type TextDecor,
  type TextDesign,
  type TextSettings,
} from './design.js';
import { type Motif, motif } from './motifs.js';
import {
  type Bounds,
  boundsOf,
  circle,
  type Contour,
  mapRegions,
  type Point,
  type Region,
} from './outline.js';
import type { FontSet } from './shaper.js';

/** One colour of the piece: flat regions (mm) extruded from z0 to z1. */
export interface Part {
  /** The colour it prints in (the product's colour option value id). */
  colour: string;
  regions: Region[];
  z0: number;
  z1: number;
}

export interface Layout {
  parts: Part[];
  /** The whole piece's size, mm. */
  size: { x: number; y: number; z: number };
}

/** A letter (or a run of text, or a decoration) placed on the piece, in mm. */
interface Placed {
  regions: Region[];
  colour: string;
  /** A gap (mm) cut around it in what lies behind, so it reads even in the same colour. */
  gap?: number;
}

/**
 * Lays the design out as print parts. Every style is letters raised on a backing that follows
 * their outline (grown by a margin and merged): the dots of an i or of Arabic letters, and the
 * words of a two-word name, all hold together as one piece. A keychain adds a ring at the start
 * of the text; single letters are separate pieces, each with its own backing; standing styles
 * get a foot.
 */
export function layoutDesign(
  fonts: FontSet,
  design: TextDesign,
  settings: TextSettings,
  logos: ReadonlyMap<string, LogoShape> = new Map(),
): Layout {
  // Designed freely: the customer placed every item in mm; nothing is shrunk to fit.
  if (BOARD_STYLES.includes(settings.style))
    return boardLayout(fonts, design, settings, logos);
  // Too wide for the piece: laid out again with smaller letters (thicknesses stay).
  let h = settings.letterHeightMm;
  let layout = layoutAt(fonts, design, settings, logos);
  for (let i = 0; i < 4 && layout.size.x > settings.maxWidthMm; i++) {
    h *= (settings.maxWidthMm / layout.size.x) * 0.995;
    layout = layoutAt(fonts, design, { ...settings, letterHeightMm: h }, logos);
  }
  return layout;
}

function layoutAt(
  fonts: FontSet,
  design: TextDesign,
  settings: TextSettings,
  logos: ReadonlyMap<string, LogoShape>,
): Layout {
  const h = settings.letterHeightMm;
  const margin = Math.max(1.5, h * 0.12);
  let placed: Placed[][];
  switch (settings.style) {
    case 'KEYCHAIN':
      placed = [keychainFace(fonts, design, h, logos)];
      break;
    case 'NAME':
      placed = [
        [run(fonts, design.fontId, design.text.trim(), h, design.textColour)],
      ];
      break;
    case 'MONOGRAM':
      placed = [monogram(fonts, design, h)];
      break;
    case 'LETTERS':
      placed = singleLetters(fonts, design, h, margin);
      break;
    case 'INITIAL_NAME':
      placed = [
        initialWithName(
          fonts,
          design,
          h,
          design.decor ?? settings.decor ?? 'HEARTS',
        ),
      ];
      break;
    case 'COUPLE':
      placed = [couple(fonts, design, h)];
      break;
    // Designed freely: a base with items placed on it (board.ts).
    case 'STANDING_INITIAL':
    case 'TROPHY':
    case 'STANDING_LOGO':
      return boardLayout(fonts, design, settings, logos);
  }

  const raw = boundsOf(placed.flat().flatMap((p) => p.regions));
  if (!raw) return { parts: [], size: { x: 0, y: 0, z: 0 } };
  // From the origin: the piece starts at 0, 0.
  const scaled = placed.map((piece) =>
    piece.map((p) => ({
      ...p,
      regions: moved(p.regions, -raw.minX, -raw.minY),
    })),
  );

  const z0 = 0;
  const z1 = settings.baseDepthMm;
  const z2 = z1 + settings.letterDepthMm;
  const base = design.baseColour ?? design.textColour;
  const parts: Part[] = [];
  for (const piece of scaled) {
    // A big initial holds its name and decorations itself: no bar along the baseline.
    let backing =
      settings.style === 'KEYCHAIN' &&
      design.shape &&
      design.shape !== 'OUTLINE'
        ? shapedPlate(piece, margin, design.shape)
        : backingOf(piece, margin, settings.style !== 'INITIAL_NAME');
    if (settings.style === 'KEYCHAIN') {
      backing = withRing(
        backing,
        h,
        isArabic(design.text),
        design.shape === 'HEART',
      );
    }
    // A standing piece gets a foot to stand on, joined to its backing.
    if (STANDING_STYLES.includes(settings.style)) {
      const foot = footOf(backing, h, margin, z2);
      backing = difference(backing, foot.regions);
      parts.push({ colour: base, ...foot });
    }
    parts.push({ colour: base, regions: backing, z0, z1 });
    // In front first: a later letter covers what it overlaps of an earlier one.
    for (const [i, p] of piece.entries()) {
      const covered = piece
        .slice(i + 1)
        .flatMap((q) => (q.gap ? grown(q.regions, q.gap) : q.regions));
      parts.push({
        colour: p.colour,
        regions: covered.length ? difference(p.regions, covered) : p.regions,
        z0: z1,
        z1: z2,
      });
    }
  }
  const merged = mergeParts(parts);
  const b = boundsOf(merged.flatMap((p) => p.regions))!;
  const zMin = Math.min(...merged.map((p) => p.z0));
  const zMax = Math.max(...merged.map((p) => p.z1));
  return {
    parts: merged,
    size: { x: b.maxX - b.minX, y: b.maxY - b.minY, z: zMax - zMin },
  };
}

/** A run of text in one font, `h` mm tall (cap height; Arabic: the ink's height). */
function run(
  fonts: FontSet,
  fontId: string,
  text: string,
  h: number,
  colour: string,
): Placed {
  const shaped = fonts.shape(fontId, text);
  const k = h / shaped.referenceHeight;
  return { regions: moved(shaped.regions, 0, 0, k), colour };
}

/** The regions scaled by `k`, then moved. */
const moved = (regions: readonly Region[], dx: number, dy: number, k = 1) =>
  mapRegions(regions, ([x, y]) => [x * k + dx, y * k + dy]);

/** Moved so its ink is centred on 0, 0. */
function centred(p: Placed): Placed {
  const b = boundsOf(p.regions)!;
  return {
    ...p,
    regions: moved(p.regions, -(b.minX + b.maxX) / 2, -(b.minY + b.maxY) / 2),
  };
}

/**
 * Up to three initials, each in its own font and colour, overlapping along an arch: with
 * three, the middle one is larger and in front.
 */
function monogram(fonts: FontSet, design: TextDesign, h: number): Placed[] {
  const letters = lettersOf(design.text);
  const big = letters.length === 3 ? 1 : -1;
  const shaped = letters.map((c, i) => {
    const style = design.letters?.[i];
    const p = centred(
      run(
        fonts,
        style?.fontId ?? design.fontId,
        c,
        i === big ? h * 1.35 : h,
        style?.colour ?? design.textColour,
      ),
    );
    const b = boundsOf(p.regions)!;
    return { ...p, width: b.maxX - b.minX };
  });
  // Side by side, each overlapping the one before by a fifth of the narrower.
  const centres: number[] = [];
  shaped.forEach((s, i) => {
    if (i === 0) return void centres.push(0);
    const prev = shaped[i - 1]!;
    centres.push(
      centres[i - 1]! +
        prev.width / 2 +
        s.width / 2 -
        0.2 * Math.min(prev.width, s.width),
    );
  });
  const mid = (centres[0]! + centres.at(-1)!) / 2;
  const radius = Math.max((centres.at(-1)! - centres[0]!) * 1.4, h * 2.5);
  const arched = shaped.map((s, i) => {
    const angle = (centres[i]! - mid) / radius;
    const [px, py] = [
      radius * Math.sin(angle),
      radius * Math.cos(angle) - radius,
    ];
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    return {
      colour: s.colour,
      regions: mapRegions(s.regions, ([x, y]) => [
        x * cos - y * sin + px,
        x * sin + y * cos + py,
      ]),
    };
  });
  // The big middle letter goes last: in front.
  return big >= 0 ? [arched[0]!, arched[2]!, arched[1]!] : arched;
}

/** Where a decoration goes around the initial, and how big (a share of its height). */
type Slot = 'TOP' | 'TOP_LEFT' | 'TOP_RIGHT' | 'LEFT' | 'RIGHT';
const DECORATIONS: Readonly<
  Record<TextDecor, { motif: Motif; slot: Slot; size: number }[]>
> = {
  HEARTS: [
    { motif: 'HEART', slot: 'TOP_RIGHT', size: 0.3 },
    { motif: 'HEART', slot: 'TOP_LEFT', size: 0.17 },
    { motif: 'HEART', slot: 'LEFT', size: 0.13 },
  ],
  FLOWERS: [
    { motif: 'FLOWER', slot: 'TOP_LEFT', size: 0.3 },
    { motif: 'HEART', slot: 'TOP_RIGHT', size: 0.18 },
    { motif: 'FLOWER', slot: 'RIGHT', size: 0.17 },
  ],
  STARS: [
    { motif: 'MOON', slot: 'TOP_LEFT', size: 0.32 },
    { motif: 'STAR', slot: 'TOP_RIGHT', size: 0.25 },
    { motif: 'STAR', slot: 'RIGHT', size: 0.14 },
  ],
  CROWN: [
    { motif: 'CROWN', slot: 'TOP', size: 0.55 },
    { motif: 'STAR', slot: 'LEFT', size: 0.16 },
    { motif: 'STAR', slot: 'RIGHT', size: 0.16 },
  ],
  BUTTERFLIES: [
    { motif: 'BUTTERFLY', slot: 'TOP_RIGHT', size: 0.34 },
    { motif: 'BUTTERFLY', slot: 'LEFT', size: 0.2 },
    { motif: 'HEART', slot: 'TOP_LEFT', size: 0.14 },
  ],
};

/**
 * The name's first letter big (in the accent font and colour), the whole name across its
 * lower part, and the product's decorations around it. Each decoration sits on the initial's
 * own edge, partly over it, so the backing holds it to the piece whatever the letter's shape.
 */
function initialWithName(
  fonts: FontSet,
  design: TextDesign,
  h: number,
  decor: TextDecor,
): Placed[] {
  const name = design.text.trim();
  const accent = design.accentColour ?? design.textColour;
  const decorColour = design.decorColour ?? accent;
  const initial = centred(
    run(
      fonts,
      design.accentFontId ?? design.fontId,
      lettersOf(name)[0]!,
      h,
      accent,
    ),
  );
  const ib = boundsOf(initial.regions)!;
  const ih = ib.maxY - ib.minY;
  const gap = Math.max(0.6, h * 0.025);

  // A little over a third of the initial's height, at most 1.6 times its width (an I is narrow).
  const shaped = centred(
    run(fonts, design.fontId, name, h * 0.36, design.textColour),
  );
  const nb = boundsOf(shaped.regions)!;
  const widest = Math.max(ib.maxX - ib.minX, h * 0.7) * 1.6;
  const k = Math.min(1, widest / (nb.maxX - nb.minX));

  const decorations = DECORATIONS[decor].map((d): Placed => {
    const size = ih * d.size;
    const target = slotPoint(ib, d.slot);
    // At the sides, the letter's own edge at that height (a slanted A's leg, not its foot).
    const edge =
      ((d.slot === 'LEFT' || d.slot === 'RIGHT') &&
        sideAt(initial.regions, target[1], d.slot)) ||
      nearestOnOutline(initial.regions, target);
    let at: Point;
    if (d.motif === 'CROWN') {
      // Standing on the top of the letter, sunk into it a little.
      at = [edge[0], edge[1] - size * 0.12];
    } else {
      // Pushed out from the edge, towards the slot, by under a third of its size.
      const [dx, dy] = [target[0] - edge[0], target[1] - edge[1]];
      const len = Math.hypot(dx, dy) || 1;
      at = [
        edge[0] + (dx / len) * size * 0.3,
        edge[1] + (dy / len) * size * 0.3,
      ];
    }
    return {
      colour: decorColour,
      regions: moved(motif(d.motif, size), at[0], at[1]),
      gap,
    };
  });
  const nameAt = moved(shaped.regions, 0, ib.minY + ih * 0.3, k);
  // The extra line: under the initial, as wide as the name may be, joined by the backing.
  const line = subtitleLine(fonts, design, h * 0.15, widest);
  const lb = line && boundsOf(line.regions);
  const under = lb
    ? [
        {
          ...line,
          regions: moved(
            line.regions,
            0,
            Math.min(ib.minY, boundsOf(nameAt)!.minY) - gap * 1.5 - lb.maxY,
          ),
        },
      ]
    : [];
  return [
    initial,
    ...decorations,
    { colour: design.textColour, regions: nameAt, gap },
    ...under,
  ];
}

/**
 * The extra line under a name (a baby's weight and birth date, a wedding date), in the name's
 * font and colour, `h` mm tall, centred on x = 0 with its top at y = 0, at most `widest` mm
 * across; null without one.
 */
function subtitleLine(
  fonts: FontSet,
  design: TextDesign,
  h: number,
  widest: number,
): Placed | null {
  const text = design.subtitle?.trim();
  if (!text) return null;
  const shaped = run(fonts, design.fontId, text, h, design.textColour);
  const b = boundsOf(shaped.regions);
  if (!b) return null;
  const k = Math.min(1, widest / Math.max(1e-6, b.maxX - b.minX));
  const cx = (b.minX + b.maxX) / 2;
  return {
    ...shaped,
    regions: mapRegions(shaped.regions, ([x, y]) => [
      (x - cx) * k,
      (y - b.maxY) * k,
    ]),
  };
}

/** A point beyond the initial in the slot's direction (its outline's nearest point is used). */
function slotPoint(b: Bounds, slot: Slot): Point {
  const w = b.maxX - b.minX;
  const high = b.minY + (b.maxY - b.minY) * 0.68;
  switch (slot) {
    case 'TOP':
      return [(b.minX + b.maxX) / 2, b.maxY + (b.maxY - b.minY)];
    case 'TOP_LEFT':
      return [b.minX, b.maxY];
    case 'TOP_RIGHT':
      return [b.maxX, b.maxY];
    case 'LEFT':
      return [b.minX - w, high];
    case 'RIGHT':
      return [b.maxX + w, high];
  }
}

/** Where a level line at `y` first meets the regions' outlines from the left or right. */
function sideAt(
  regions: readonly Region[],
  y: number,
  side: 'LEFT' | 'RIGHT',
): Point | null {
  let best: number | null = null;
  for (const { outer: c } of regions) {
    for (let i = 0; i < c.length; i++) {
      const [ax, ay] = c[i]!;
      const [bx, by] = c[(i + 1) % c.length]!;
      if ((ay - y) * (by - y) > 0 || ay === by) continue;
      const x = ax + ((y - ay) / (by - ay)) * (bx - ax);
      if (best === null || (side === 'LEFT' ? x < best : x > best)) best = x;
    }
  }
  return best === null ? null : [best, y];
}

/** The point on the regions' outlines nearest to `to`. */
function nearestOnOutline(regions: readonly Region[], to: Point): Point {
  let best: Point = to;
  let bestD = Infinity;
  for (const { outer: c } of regions) {
    for (let i = 0; i < c.length; i++) {
      const [ax, ay] = c[i]!;
      const [bx, by] = c[(i + 1) % c.length]!;
      const [ex, ey] = [bx - ax, by - ay];
      const l2 = ex * ex + ey * ey;
      const t =
        l2 > 0
          ? Math.max(
              0,
              Math.min(1, ((to[0] - ax) * ex + (to[1] - ay) * ey) / l2),
            )
          : 0;
      const p: Point = [ax + ex * t, ay + ey * t];
      const d = Math.hypot(p[0] - to[0], p[1] - to[1]);
      if (d < bestD) [best, bestD] = [p, d];
    }
  }
  return best;
}

/**
 * Two names (typed "Sara & Ali") on one baseline with a heart between them in the accent
 * colour. Arabic reads right to left: the first name on the right.
 */
function couple(fonts: FontSet, design: TextDesign, h: number): Placed[] {
  const [one, two] = coupleNames(design.text).map((n) =>
    run(fonts, design.fontId, n, h, design.textColour),
  ) as [Placed, Placed];
  const [left, right] = isArabic(design.text) ? [two, one] : [one, two];
  const size = h * 1.15;
  const space = h * 0.22;
  const lb = boundsOf(left.regions)!;
  const rb = boundsOf(right.regions)!;
  const pieces: Placed[] = [
    { ...left, regions: moved(left.regions, -size / 2 - space - lb.maxX, 0) },
    { ...right, regions: moved(right.regions, size / 2 + space - rb.minX, 0) },
    {
      colour: design.accentColour ?? design.textColour,
      regions: moved(motif('HEART', size), 0, h * 0.5),
      gap: Math.max(0.6, h * 0.025),
    },
  ];
  // The extra line (a wedding date) under the names, centred under the heart.
  const all = boundsOf(pieces.flatMap((p) => p.regions))!;
  const line = subtitleLine(
    fonts,
    design,
    h * 0.4,
    (all.maxX - all.minX) * 0.8,
  );
  if (line)
    pieces.push({
      ...line,
      regions: moved(line.regions, 0, all.minY - h * 0.25),
    });
  return pieces;
}

/** Single letters in a row, each its own piece (its own backing), in its font and colour. */
function singleLetters(
  fonts: FontSet,
  design: TextDesign,
  h: number,
  margin: number,
): Placed[][] {
  let x = 0;
  return lettersOf(design.text).map((c, i) => {
    const style = design.letters?.[i];
    const p = run(
      fonts,
      style?.fontId ?? design.fontId,
      c,
      h,
      style?.colour ?? design.textColour,
    );
    const b = boundsOf(p.regions)!;
    const dx = x - b.minX + margin;
    x += b.maxX - b.minX + margin * 3;
    return [{ ...p, regions: moved(p.regions, dx, 0) }];
  });
}

/**
 * The backing under a piece's letters: their outline grown by `margin` and merged, with a
 * bar along the baseline so separate words (and separate letters of a monogram) stay joined.
 */
function backingOf(
  piece: Placed[],
  margin: number,
  withBar: boolean,
): Region[] {
  const letters = piece.flatMap((p) => p.regions);
  if (!withBar) return grown(letters, margin);
  const b = boundsOf(letters)!;
  const height = b.maxY - b.minY;
  const bar: Contour = [
    [b.minX, b.minY + height * 0.15],
    [b.maxX, b.minY + height * 0.15],
    [b.maxX, b.minY + height * 0.15 + Math.max(margin, height * 0.18)],
    [b.minX, b.minY + height * 0.15 + Math.max(margin, height * 0.18)],
  ];
  return union([...grown(letters, margin), { outer: bar, holes: [] }]);
}

/**
 * The foot a standing piece rests on: a bar under the backing, wider than it and much deeper
 * than the piece is thick (centred on it), so the name or initials stand without tipping.
 */
function footOf(
  backing: Region[],
  h: number,
  margin: number,
  thickness: number,
): { regions: Region[]; z0: number; z1: number } {
  const b = boundsOf(backing)!;
  const height = Math.max(3, h * 0.18);
  const depth = Math.max(12, thickness * 2.5, h * 0.6);
  const top = b.minY + height * 0.4;
  const outer: Contour = [
    [b.minX - margin, b.minY - height * 0.6],
    [b.maxX + margin, b.minY - height * 0.6],
    [b.maxX + margin, top],
    [b.minX - margin, top],
  ];
  return {
    regions: [{ outer, holes: [] }],
    z0: thickness / 2 - depth / 2,
    z1: thickness / 2 + depth / 2,
  };
}

/**
 * A keychain's face: the name, and a logo after it (the end of the reading, away from the
 * ring), a little taller than the capitals, in the letters' colour or in its own colours; or
 * the logo alone.
 */
function keychainFace(
  fonts: FontSet,
  design: TextDesign,
  h: number,
  logos: ReadonlyMap<string, LogoShape>,
): Placed[] {
  const text = design.text.trim();
  const shape = design.logoId ? logos.get(design.logoId) : undefined;
  const logo = shape?.outline;
  const lb = logo && logo.length ? boundsOf(logo) : null;
  if (text === '') {
    // A logo alone (no name): the logo is the face, twice the letters' height.
    if (!shape || !lb) return [];
    const k = (h * 2) / Math.max(1e-6, lb.maxY - lb.minY);
    return logoPlaced(design, shape, (r) =>
      moved(r, -lb.minX * k, -lb.minY * k, k),
    );
  }
  const name = run(fonts, design.fontId, text, h, design.textColour);
  if (!shape || !lb) return [name];
  const b = boundsOf(name.regions)!;
  const k = (h * 1.25) / Math.max(1e-6, lb.maxY - lb.minY);
  const width = (lb.maxX - lb.minX) * k;
  const gap = h * 0.35;
  const rightToLeft = isArabic(design.text);
  // Centred on the letters' height, after the last letter.
  const x = rightToLeft ? b.minX - gap - width : b.maxX + gap;
  const cy = (b.minY + b.maxY) / 2;
  return [
    name,
    ...logoPlaced(design, shape, (r) =>
      moved(r, x - lb.minX * k, cy - ((lb.minY + lb.maxY) / 2) * k, k),
    ),
  ];
}

/**
 * The logo as placed: in the letters' colour; or, when the customer chose a colour for each
 * of its colours, its outline in the first (largest) and the others over it, each in its own.
 */
function logoPlaced(
  design: TextDesign,
  shape: LogoShape,
  place: (regions: readonly Region[]) => Region[],
): Placed[] {
  const inks = shape.inks ?? [];
  const chosen = design.logoColours ?? [];
  if (inks.length < 2 || chosen.length !== inks.length)
    return [{ regions: place(shape.outline), colour: design.textColour }];
  return [
    { regions: place(shape.outline), colour: chosen[0]! },
    ...inks.slice(1).map((ink, i) => ({
      regions: place(ink.regions),
      colour: chosen[i + 1]!,
    })),
  ];
}

/** A keychain plate in a chosen shape, big enough to hold its letters (and logo). */
function shapedPlate(
  piece: Placed[],
  margin: number,
  shape: 'ROUNDED' | 'OVAL' | 'HEART',
): Region[] {
  const b = boundsOf(piece.flatMap((p) => p.regions))!;
  const w = b.maxX - b.minX + margin * 2;
  const hgt = b.maxY - b.minY + margin * 2;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  switch (shape) {
    case 'ROUNDED': {
      const r = Math.min(w, hgt) * 0.3;
      const corners: Point[] = [
        [cx - w / 2 + r, cy - hgt / 2 + r],
        [cx + w / 2 - r, cy - hgt / 2 + r],
        [cx + w / 2 - r, cy + hgt / 2 - r],
        [cx - w / 2 + r, cy + hgt / 2 - r],
      ];
      return union([
        { outer: rectangle(cx, cy, w - 2 * r, hgt), holes: [] },
        { outer: rectangle(cx, cy, w, hgt - 2 * r), holes: [] },
        ...corners.map(([x, y]) => ({ outer: circle(x, y, r, 24), holes: [] })),
      ]);
    }
    case 'OVAL': {
      // The ellipse through the rectangle's corners.
      const a = (w / 2) * Math.SQRT2;
      const c = (hgt / 2) * Math.SQRT2;
      const outer: Contour = Array.from({ length: 72 }, (_, i) => {
        const t = (i / 72) * Math.PI * 2;
        return [cx + a * Math.cos(t), cy + c * Math.sin(t)] as Point;
      });
      return [{ outer, holes: [] }];
    }
    case 'HEART': {
      // The heart's widest band holds the text: sized so the letters fit across it.
      const size = Math.max(w / 0.7, hgt / 0.45);
      return mapRegions(motif('HEART', size), ([x, y]) => [
        x + cx,
        y + cy - size * 0.06,
      ]);
    }
  }
}

/** A rectangle w x h centred on cx, cy. */
const rectangle = (cx: number, cy: number, w: number, h: number): Contour => [
  [cx - w / 2, cy - h / 2],
  [cx + w / 2, cy - h / 2],
  [cx + w / 2, cy + h / 2],
  [cx - w / 2, cy + h / 2],
];

/** The keychain ring's outer radius for letters `h` mm tall. */
const ringSize = (h: number) => Math.max(5, h * 0.45);

/**
 * A ring joined to the backing at the start of the text (the left; the right for Arabic,
 * which reads right to left), its hole cut cleanly through. The hole fits a key ring's wire.
 * It overlaps the backing's own edge at its height, not the edge of its box: a heart is
 * narrower at mid-height than across its lobes, so a ring there floated free. A heart's ring
 * sits on the side of a lobe, where the heart is widest.
 */
function withRing(
  backing: Region[],
  h: number,
  rightToLeft: boolean,
  onLobe = false,
): Region[] {
  const b = boundsOf(backing)!;
  const r = ringSize(h);
  const hole = Math.max(2.6, r * 0.5);
  const side = rightToLeft ? 'RIGHT' : 'LEFT';
  const cy = onLobe ? widestAt(backing, side) : (b.minY + b.maxY) / 2;
  const edge =
    sideAt(backing, cy, side)?.[0] ?? (rightToLeft ? b.maxX : b.minX);
  const cx = rightToLeft ? edge + r * 0.45 : edge - r * 0.45;
  return difference(
    union([...backing, { outer: circle(cx, cy, r), holes: [] }]),
    [{ outer: circle(cx, cy, hole), holes: [] }],
  );
}

/** The height of the regions' outermost point on that side. */
function widestAt(regions: readonly Region[], side: 'LEFT' | 'RIGHT'): number {
  let best: Point | null = null;
  for (const { outer } of regions)
    for (const p of outer)
      if (!best || (side === 'LEFT' ? p[0] < best[0] : p[0] > best[0]))
        best = p;
  return best ? best[1] : 0;
}

/** Parts of one colour at the same height become one (their regions merged). */
function mergeParts(parts: Part[]): Part[] {
  const byKey = new Map<string, Part>();
  for (const p of parts) {
    if (p.regions.length === 0) continue;
    const key = `${p.colour}|${p.z0}|${p.z1}`;
    const found = byKey.get(key);
    byKey.set(
      key,
      found
        ? { ...found, regions: union([...found.regions, ...p.regions]) }
        : p,
    );
  }
  return [...byKey.values()];
}
