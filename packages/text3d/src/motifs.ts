import { difference, union } from './clip.js';
import type { BoardMotif } from './design.js';
import { circle, type Contour, type Point, type Region } from './outline.js';

/**
 * Decorations drawn as shapes (no font): each `size` mm across, centred on 0, 0 (the crown
 * stands on 0, 0).
 */
export type Motif = BoardMotif;

export function motif(kind: Motif, size: number): Region[] {
  switch (kind) {
    case 'HEART':
      return [{ outer: heart(size), holes: [] }];
    case 'STAR':
      return [{ outer: star(size), holes: [] }];
    case 'FLOWER': {
      const r = size * 0.19;
      const petals = Array.from({ length: 5 }, (_, i) => {
        const a = Math.PI / 2 + (i / 5) * Math.PI * 2;
        const d = size * 0.3;
        return solid(circle(d * Math.cos(a), d * Math.sin(a), r, 32));
      });
      // A hole at the heart of the flower, the petals around it.
      return difference(union([...petals, solid(circle(0, 0, r, 32))]), [
        solid(circle(0, 0, r * 0.45, 24)),
      ]);
    }
    case 'MOON': {
      const r = size / 2;
      return difference(
        [solid(circle(0, 0, r))],
        [solid(circle(r * 0.42, r * 0.22, r * 0.82))],
      );
    }
    case 'BUTTERFLY': {
      // Two wings a side swept out from a slim body, and two antennae thick enough to print.
      const e = (x: number, y: number, rx: number, ry: number, tilt: number) =>
        solid(ellipse(x * size, y * size, rx * size, ry * size, tilt));
      const feeler = Math.max(0.03 * size, 0.55);
      return union([
        e(-0.25, 0.13, 0.25, 0.17, -0.55),
        e(0.25, 0.13, 0.25, 0.17, 0.55),
        e(-0.17, -0.16, 0.17, 0.11, 0.6),
        e(0.17, -0.16, 0.17, 0.11, -0.6),
        e(0, -0.02, 0.045, 0.24, 0),
        solid(ellipse(-0.07 * size, 0.3 * size, feeler, 0.12 * size, 0.45)),
        solid(ellipse(0.07 * size, 0.3 * size, feeler, 0.12 * size, -0.45)),
        solid(
          circle(-0.125 * size, 0.41 * size, Math.max(0.045 * size, 0.8), 20),
        ),
        solid(
          circle(0.125 * size, 0.41 * size, Math.max(0.045 * size, 0.8), 20),
        ),
      ]);
    }
    case 'CROWN': {
      const w = size;
      const tips: Point[] = [
        [-0.5 * w, 0.58 * w],
        [0, 0.68 * w],
        [0.5 * w, 0.58 * w],
      ];
      const band: Contour = [
        [-0.42 * w, 0],
        [0.42 * w, 0],
        tips[2]!,
        [0.22 * w, 0.3 * w],
        tips[1]!,
        [-0.22 * w, 0.3 * w],
        tips[0]!,
      ];
      return union([
        solid(band),
        ...tips.map(([x, y]) => solid(circle(x, y, w * 0.07, 24))),
      ]);
    }
  }
}

const solid = (outer: Contour): Region => ({ outer, holes: [] });

/** An ellipse centred on x, y, its x radius turned by `tilt` radians. */
function ellipse(
  x: number,
  y: number,
  rx: number,
  ry: number,
  tilt: number,
): Contour {
  const [c, s] = [Math.cos(tilt), Math.sin(tilt)];
  return Array.from({ length: 40 }, (_, i): Point => {
    const t = (i / 40) * Math.PI * 2;
    const [ex, ey] = [rx * Math.cos(t), ry * Math.sin(t)];
    return [x + ex * c - ey * s, y + ex * s + ey * c];
  });
}

/** The classic heart curve, `size` mm wide, centred. */
function heart(size: number): Contour {
  const k = size / 32;
  const points: Point[] = [];
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    points.push([
      16 * Math.sin(t) ** 3 * k,
      (13 * Math.cos(t) -
        5 * Math.cos(2 * t) -
        2 * Math.cos(3 * t) -
        Math.cos(4 * t)) *
        k,
    ]);
  }
  const ys = points.map(([, y]) => y);
  const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
  return points.map(([x, y]) => [x, y - mid] as Point);
}

/** A five-pointed star, `size` mm across its points. */
function star(size: number): Contour {
  const r = size / 2;
  return Array.from({ length: 10 }, (_, i) => {
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
    const d = i % 2 === 0 ? r : r * 0.45;
    return [d * Math.cos(a), d * Math.sin(a)] as Point;
  });
}
