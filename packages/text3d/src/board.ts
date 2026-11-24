import { difference, grown, union } from './clip.js';
import {
  type BoardItem,
  lettersOf,
  type LogoShape,
  type TextDesign,
  type TextSettings,
} from './design.js';
import { motif } from './motifs.js';
import {
  type Bounds,
  boundsOf,
  type Contour,
  mapRegions,
  type Point,
  type Region,
  signedArea,
} from './outline.js';
import type { FontSet } from './shaper.js';

/** One colour of a piece: flat regions (mm) extruded from z0 to z1 (as layout.ts's Part). */
export interface BoardPart {
  colour: string;
  regions: Region[];
  z0: number;
  z1: number;
}

/**
 * A board piece seen from the front, flat, in mm with the base's centre at 0, 0 (y up): the
 * base (the initial, or the trophy's plaque) and each item where it is. The customer's editor
 * draws exactly this, and the print is made from it, so what they drag is what prints.
 */
export interface BoardShapes {
  base: Region[];
  items: { id: string; colour: string; regions: Region[] }[];
}

export function boardShapes(
  fonts: FontSet,
  design: TextDesign,
  settings: TextSettings,
  logos: ReadonlyMap<string, LogoShape> = new Map(),
): BoardShapes {
  return {
    base: baseOf(fonts, design, settings),
    items: (design.items ?? []).flatMap((item) => {
      const regions = itemRegions(fonts, design, item, logos);
      return regions.length
        ? [{ id: item.id, colour: item.colour, regions }]
        : [];
    }),
  };
}

/**
 * The piece as print parts: the base and a frame of its colour behind any item that reaches
 * past it (so nothing hangs in the air), `baseDepthMm` thick; the items raised
 * `letterDepthMm` on its face, each in its colour, a later one over an earlier one. The
 * initial stands on its own flat foot; the trophy's plaque on a foot of its own.
 */
export function boardLayout(
  fonts: FontSet,
  design: TextDesign,
  settings: TextSettings,
  logos: ReadonlyMap<string, LogoShape> = new Map(),
): { parts: BoardPart[]; size: { x: number; y: number; z: number } } {
  const shapes = boardShapes(fonts, design, settings, logos);
  const h = settings.letterHeightMm;
  const margin = Math.max(1.2, h * 0.012);
  const bb = boundsOf(shapes.base);
  if (!bb) return { parts: [], size: { x: 0, y: 0, z: 0 } };
  const T = settings.baseDepthMm;
  const top = T + settings.letterDepthMm;
  // The base is the design's own colour; items bring theirs.
  const baseColour = design.textColour;

  let frame = union([
    ...shapes.base,
    ...grown(
      shapes.items.flatMap((i) => i.regions),
      margin,
    ),
  ]);
  // Narrow gaps between things fill in smoothly (grown, then shrunk back); anything still
  // off the base would print as a loose bit, so a stem joins it to the base.
  const close = Math.max(3, h * 0.04);
  frame = union([...frame, ...grown(grown(frame, close), -close)]);
  frame = joined(frame, bb, Math.max(3, h * 0.035));
  // Nothing below the base's own bottom: it stands flat on it.
  frame = difference(frame, [rect(-1e4, bb.minY - 1e4, 2e4, 1e4)]);

  const parts: BoardPart[] = [];
  if (settings.style === 'TROPHY') {
    // The plaque stands on a foot, deeper than it is thick.
    const fb = boundsOf(frame)!;
    const footH = Math.max(6, h * 0.08);
    const depth = Math.max(40, top * 3);
    parts.push({
      colour: baseColour,
      regions: [
        rect(
          fb.minX - margin * 4,
          fb.minY - footH,
          fb.maxX - fb.minX + margin * 8,
          footH,
        ),
      ],
      z0: top / 2 - depth / 2,
      z1: top / 2 + depth / 2,
    });
  }
  parts.push({ colour: baseColour, regions: frame, z0: 0, z1: T });
  shapes.items.forEach((item, i) => {
    const later = shapes.items.slice(i + 1).flatMap((l) => l.regions);
    const regions = later.length
      ? difference(item.regions, later)
      : item.regions;
    if (regions.length)
      parts.push({ colour: item.colour, regions, z0: T, z1: top });
  });
  // One part per colour and height: the items of one colour become one solid.
  const byKey = new Map<string, BoardPart>();
  for (const p of parts) {
    const key = `${p.colour}|${p.z0}|${p.z1}`;
    const found = byKey.get(key);
    byKey.set(
      key,
      found
        ? { ...found, regions: union([...found.regions, ...p.regions]) }
        : p,
    );
  }
  parts.splice(0, parts.length, ...byKey.values());
  const all = boundsOf(parts.flatMap((p) => p.regions))!;
  const zMin = Math.min(...parts.map((p) => p.z0));
  const zMax = Math.max(...parts.map((p) => p.z1));
  return {
    parts,
    size: { x: all.maxX - all.minX, y: all.maxY - all.minY, z: zMax - zMin },
  };
}

/**
 * The frame as one piece: each island that isn't the base's own (it holds the base's box) gets
 * a stem `width` wide from its nearest point to the nearest point of the base's island.
 */
function joined(frame: Region[], base: Bounds, width: number): Region[] {
  const holds = (r: Region) => {
    const b = boundsOf([r])!;
    const e = 0.01;
    return (
      b.minX <= base.minX + e &&
      b.minY <= base.minY + e &&
      b.maxX >= base.maxX - e &&
      b.maxY >= base.maxY - e
    );
  };
  const main = frame.find(holds);
  if (!main || frame.length < 2) return frame;
  const stems = frame
    .filter((r) => r !== main)
    .map((island) => {
      let best: [Point, Point] = [island.outer[0]!, main.outer[0]!];
      let d = Infinity;
      for (const a of island.outer)
        for (const b of main.outer) {
          const dd = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
          if (dd < d) [d, best] = [dd, [a, b]];
        }
      return stem(best[0], best[1], width);
    });
  return union([...frame, ...stems]);
}

/** A bar `width` wide from a to b, reaching `width` past each end (into what it joins). */
function stem(a: Point, b: Point, width: number): Region {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const [dx, dy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const [nx, ny] = [(-dy * width) / 2, (dx * width) / 2];
  const [ax, ay] = [a[0] - dx * width, a[1] - dy * width];
  const [bx, by] = [b[0] + dx * width, b[1] + dy * width];
  const outer: Contour = [
    [ax + nx, ay + ny],
    [ax - nx, ay - ny],
    [bx - nx, by - ny],
    [bx + nx, by + ny],
  ];
  return { outer: signedArea(outer) < 0 ? outer.reverse() : outer, holes: [] };
}

/** The base, centred on 0, 0: the design's initial (standing), or the trophy's plaque. */
function baseOf(
  fonts: FontSet,
  design: TextDesign,
  settings: TextSettings,
): Region[] {
  const h = settings.letterHeightMm;
  if (settings.style === 'TROPHY') {
    const w = Math.min(settings.maxWidthMm, h * 1.4);
    const r = Math.min(w, h) * 0.08;
    return grown([rect(-w / 2 + r, -h / 2 + r, w - 2 * r, h - 2 * r)], r);
  }
  const letter = lettersOf(design.text.trim())[0] ?? 'A';
  const shaped = fonts.shape(design.accentFontId ?? design.fontId, letter);
  const k = h / shaped.referenceHeight;
  const regions = centred(
    mapRegions(shaped.regions, ([x, y]) => [x * k, y * k]),
  );
  // Its bottom trimmed flat (a slanted or round foot would rock), as the Ayla initial is.
  const b = boundsOf(regions)!;
  return difference(regions, [
    rect(b.minX - 1, b.minY - 1, b.maxX - b.minX + 2, 1 + h * 0.03),
  ]);
}

/** One item's outline where it is: its shape `size` mm tall, centred, turned, then moved. */
function itemRegions(
  fonts: FontSet,
  design: TextDesign,
  item: BoardItem,
  logos: ReadonlyMap<string, LogoShape>,
): Region[] {
  let shape: Region[] = [];
  let height = 1;
  if (item.kind === 'TEXT') {
    const text = item.text?.trim();
    if (!text) return [];
    const fontId =
      item.fontId && fonts.has(item.fontId) ? item.fontId : design.fontId;
    const shaped = fonts.shape(fontId, text);
    shape = shaped.regions;
    height = shaped.referenceHeight;
  } else if (item.kind === 'MOTIF') {
    if (!item.motif) return [];
    // At its real size: motifs keep thin parts thick enough to print (mm).
    shape = motif(item.motif, item.size);
    const b = boundsOf(shape);
    height = b ? b.maxY - b.minY : 1;
  } else {
    const logo = item.logoId ? logos.get(item.logoId) : undefined;
    if (!logo) return [];
    shape = logo.outline;
    const b = boundsOf(shape);
    height = b ? b.maxY - b.minY : 1;
  }
  const b = boundsOf(shape);
  if (!b || height <= 0) return [];
  const k = item.size / height;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const a = (item.rotation * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return mapRegions(shape, ([x, y]): Point => {
    const [px, py] = [(x - cx) * k, (y - cy) * k];
    return [item.x + px * c - py * s, item.y + px * s + py * c];
  });
}

function centred(regions: Region[]): Region[] {
  const b = boundsOf(regions);
  if (!b) return regions;
  const [cx, cy] = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  return mapRegions(regions, ([x, y]) => [x - cx, y - cy]);
}

function rect(x: number, y: number, w: number, h: number): Region {
  const outer: Contour = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
  return { outer, holes: [] };
}
