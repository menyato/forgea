/**
 * Glyph outlines as plain polygons: curves flattened into short straight segments, and
 * contours sorted into solid regions with their holes (the inside of an "o", the eye of an
 * "e"). Holes are found by nesting, not by drawing direction, because fonts disagree on it
 * (TrueType draws outlines clockwise, CFF counter-clockwise).
 */
export type Point = readonly [number, number];
export type Contour = Point[];

/** One solid area: its outline and the holes cut out of it. */
export interface Region {
  outer: Contour;
  holes: Contour[];
}

/** A drawing command as HarfBuzz gives it (SVG path segments in font units, y up). */
export interface PathCommand {
  type: string;
  values: number[];
}

/** Segments per curve: smooth at print size, light enough to price in milliseconds. */
const CURVE_STEPS = 8;

/** Closed polygons from M/L/Q/C/Z commands, curves flattened. */
export function contoursFromPath(
  commands: readonly PathCommand[],
  steps = CURVE_STEPS,
): Contour[] {
  const contours: Contour[] = [];
  let current: Point[] = [];
  let pen: Point = [0, 0];
  const close = () => {
    const c = dedupe(current);
    if (c.length >= 3 && Math.abs(signedArea(c)) > 1e-9) contours.push(c);
    current = [];
  };
  for (const { type, values: v } of commands) {
    switch (type) {
      case 'M':
        close();
        pen = [v[0]!, v[1]!];
        current.push(pen);
        break;
      case 'L':
        pen = [v[0]!, v[1]!];
        current.push(pen);
        break;
      case 'Q': {
        const [cx, cy, x, y] = v as [number, number, number, number];
        const [x0, y0] = pen;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const a = (1 - t) * (1 - t);
          const b = 2 * (1 - t) * t;
          const c = t * t;
          current.push([a * x0 + b * cx + c * x, a * y0 + b * cy + c * y]);
        }
        pen = [x, y];
        break;
      }
      case 'C': {
        const [c1x, c1y, c2x, c2y, x, y] = v as [
          number,
          number,
          number,
          number,
          number,
          number,
        ];
        const [x0, y0] = pen;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const u = 1 - t;
          const a = u * u * u;
          const b = 3 * u * u * t;
          const c = 3 * u * t * t;
          const d = t * t * t;
          current.push([
            a * x0 + b * c1x + c * c2x + d * x,
            a * y0 + b * c1y + c * c2y + d * y,
          ]);
        }
        pen = [x, y];
        break;
      }
      case 'Z':
        close();
        break;
      default:
        throw new Error(`Unknown path command ${type}`);
    }
  }
  close();
  return contours;
}

/** Contours sorted into solid regions and holes, by how deeply each one is nested. */
export function regionsOf(contours: readonly Contour[]): Region[] {
  const areas = contours.map((c) => Math.abs(signedArea(c)));
  const depth = contours.map((c, i) =>
    contours.reduce(
      (d, other, j) =>
        j !== i && areas[j]! > areas[i]! && pointInPolygon(c[0]!, other)
          ? d + 1
          : d,
      0,
    ),
  );
  const regions: { region: Region; index: number }[] = [];
  contours.forEach((c, i) => {
    if (depth[i]! % 2 === 0)
      regions.push({ region: { outer: c, holes: [] }, index: i });
  });
  contours.forEach((c, i) => {
    if (depth[i]! % 2 === 0) return;
    // The smallest solid region around the hole owns it.
    let owner: { region: Region; index: number } | undefined;
    for (const r of regions) {
      if (
        depth[r.index] === depth[i]! - 1 &&
        pointInPolygon(c[0]!, r.region.outer) &&
        (!owner || areas[r.index]! < areas[owner.index]!)
      )
        owner = r;
    }
    owner?.region.holes.push(c);
  });
  return regions.map((r) => r.region);
}

export function signedArea(c: readonly Point[]): number {
  let s = 0;
  for (let i = 0; i < c.length; i++) {
    const [x1, y1] = c[i]!;
    const [x2, y2] = c[(i + 1) % c.length]!;
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function pointInPolygon([x, y]: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** The same regions moved, scaled or turned. */
export function mapRegions(
  regions: readonly Region[],
  f: (p: Point) => Point,
): Region[] {
  return regions.map((r) => ({
    outer: r.outer.map(f),
    holes: r.holes.map((h) => h.map(f)),
  }));
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(regions: readonly Region[]): Bounds | null {
  let b: Bounds | null = null;
  for (const r of regions) {
    for (const [x, y] of r.outer) {
      b = b
        ? {
            minX: Math.min(b.minX, x),
            minY: Math.min(b.minY, y),
            maxX: Math.max(b.maxX, x),
            maxY: Math.max(b.maxY, y),
          }
        : { minX: x, minY: y, maxX: x, maxY: y };
    }
  }
  return b;
}

/** A circle as a polygon, counter-clockwise. */
export function circle(
  cx: number,
  cy: number,
  r: number,
  segments = 48,
): Contour {
  return Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Point;
  });
}

function dedupe(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) out.push(p);
  }
  const first = out[0];
  const last = out.at(-1);
  if (
    first &&
    last &&
    out.length > 1 &&
    Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1e-6
  )
    out.pop();
  return out;
}
