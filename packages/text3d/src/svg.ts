import {
  boundsOf,
  contoursFromPath,
  type Contour,
  mapRegions,
  type PathCommand,
  type Point,
  type Region,
  regionsOf,
} from './outline.js';

/**
 * A logo's drawing (an SVG file) as flat solid regions, y up, scaled so its larger side is
 * 1 and centred on 0, 0: slots and keychains size it as they need. Reads paths, polygons,
 * polylines, rectangles, circles and ellipses, with their (and their groups') transforms;
 * everything drawn is solid, nested shapes become holes (as a logo's letters cut its badge).
 * No DOM, so it runs in the API's worker and in the browser alike. Throws on a file with
 * nothing to draw.
 */
export function logoRegionsFromSvg(svg: string): Region[] {
  const contours: Contour[] = [];
  const stack: Matrix[] = [IDENTITY];
  // Tags in order: an opening group pushes its transform, its closing tag pops it.
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    const [, closing, rawName, attrs, selfClosing] = m;
    const name = rawName!.toLowerCase();
    if (closing) {
      if (name === 'g' || name === 'svg') stack.pop();
      continue;
    }
    const own = attr(attrs!, 'transform');
    const matrix = multiply(stack.at(-1) ?? IDENTITY, parseTransform(own));
    if (name === 'g' || name === 'svg') {
      if (!selfClosing) stack.push(matrix);
      continue;
    }
    // Hidden parts (defs, clip paths, masks) are not drawn.
    if (/display\s*[:=]\s*["']?none/.test(attrs!)) continue;
    for (const c of shapeContours(name, attrs!))
      contours.push(c.map((p) => apply(matrix, p)));
  }
  if (contours.length === 0) throw new Error('This SVG has no shapes to print');
  if (contours.reduce((n, c) => n + c.length, 0) > MAX_LOGO_POINTS)
    throw new Error(
      'This SVG is too detailed: simplify it and upload it again',
    );
  // SVG's y runs down; print outlines run up.
  const regions = regionsOf(contours.map((c) => c.map(([x, y]) => [x, -y])));
  const b = boundsOf(regions);
  if (!b || b.maxX - b.minX <= 0 || b.maxY - b.minY <= 0)
    throw new Error('This SVG has no shapes to print');
  const k = 1 / Math.max(b.maxX - b.minX, b.maxY - b.minY);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return mapRegions(regions, ([x, y]) => [(x - cx) * k, (y - cy) * k]);
}

/** Most points one logo may have (a traced photo can have millions: refused). */
export const MAX_LOGO_POINTS = 200_000;

function shapeContours(name: string, attrs: string): Contour[] {
  const num = (key: string, fallback = 0) => {
    const v = Number.parseFloat(attr(attrs, key) ?? '');
    return Number.isFinite(v) ? v : fallback;
  };
  switch (name) {
    case 'path': {
      const d = attr(attrs, 'd');
      return d ? contoursFromPath(pathCommands(d), 12) : [];
    }
    case 'polygon':
    case 'polyline': {
      const n = numbers(attr(attrs, 'points') ?? '');
      const pts: Point[] = [];
      for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i]!, n[i + 1]!]);
      return pts.length >= 3 ? [pts] : [];
    }
    case 'rect': {
      const x = num('x');
      const y = num('y');
      const w = num('width');
      const h = num('height');
      return w > 0 && h > 0
        ? [
            [
              [x, y],
              [x + w, y],
              [x + w, y + h],
              [x, y + h],
            ],
          ]
        : [];
    }
    case 'circle':
    case 'ellipse': {
      const cx = num('cx');
      const cy = num('cy');
      const rx = name === 'circle' ? num('r') : num('rx');
      const ry = name === 'circle' ? num('r') : num('ry');
      if (rx <= 0 || ry <= 0) return [];
      return [
        Array.from({ length: 48 }, (_, i): Point => {
          const a = (i / 48) * Math.PI * 2;
          return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
        }),
      ];
    }
    default:
      return [];
  }
}

const attr = (attrs: string, key: string): string | undefined =>
  new RegExp(`(?:^|\\s)${key}\\s*=\\s*(["'])([\\s\\S]*?)\\1`).exec(attrs)?.[2];

const numbers = (s: string): number[] =>
  (s.match(/-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);

/**
 * An SVG path's `d` as absolute M/L/Q/C/Z commands (what `contoursFromPath` reads): relative
 * commands made absolute, H/V/S/T expanded, arcs drawn as short lines.
 */
export function pathCommands(d: string): PathCommand[] {
  const out: PathCommand[] = [];
  const tokens =
    d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastCtrl: Point | null = null;
  let lastType = '';
  const next = () => Number(tokens[i++]);
  const more = () => i < tokens.length && !/[a-zA-Z]/.test(tokens[i]!);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i]!)) cmd = tokens[i++]!;
    else if (!cmd) {
      i++;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    if (C === 'Z') {
      out.push({ type: 'Z', values: [] });
      x = startX;
      y = startY;
      lastCtrl = null;
      lastType = 'Z';
      cmd = '';
      continue;
    }
    if (!more()) break;
    switch (C) {
      case 'M': {
        x = ox + next();
        y = oy + next();
        startX = x;
        startY = y;
        out.push({ type: 'M', values: [x, y] });
        // Further pairs after M are lines.
        cmd = rel ? 'l' : 'L';
        lastCtrl = null;
        break;
      }
      case 'L':
        x = ox + next();
        y = oy + next();
        out.push({ type: 'L', values: [x, y] });
        lastCtrl = null;
        break;
      case 'H':
        x = ox + next();
        out.push({ type: 'L', values: [x, y] });
        lastCtrl = null;
        break;
      case 'V':
        y = oy + next();
        out.push({ type: 'L', values: [x, y] });
        lastCtrl = null;
        break;
      case 'C': {
        const v = [next(), next(), next(), next(), next(), next()];
        const c1: Point = [ox + v[0]!, oy + v[1]!];
        const c2: Point = [ox + v[2]!, oy + v[3]!];
        x = ox + v[4]!;
        y = oy + v[5]!;
        out.push({ type: 'C', values: [...c1, ...c2, x, y] });
        lastCtrl = c2;
        break;
      }
      case 'S': {
        const v = [next(), next(), next(), next()];
        const c1: Point =
          lastCtrl && (lastType === 'C' || lastType === 'S')
            ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]]
            : [x, y];
        const c2: Point = [ox + v[0]!, oy + v[1]!];
        x = ox + v[2]!;
        y = oy + v[3]!;
        out.push({ type: 'C', values: [...c1, ...c2, x, y] });
        lastCtrl = c2;
        break;
      }
      case 'Q': {
        const v = [next(), next(), next(), next()];
        const c: Point = [ox + v[0]!, oy + v[1]!];
        x = ox + v[2]!;
        y = oy + v[3]!;
        out.push({ type: 'Q', values: [...c, x, y] });
        lastCtrl = c;
        break;
      }
      case 'T': {
        const c: Point =
          lastCtrl && (lastType === 'Q' || lastType === 'T')
            ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]]
            : [x, y];
        x = ox + next();
        y = oy + next();
        out.push({ type: 'Q', values: [...c, x, y] });
        lastCtrl = c;
        break;
      }
      case 'A': {
        const [rx, ry, rot, large, sweep, ex, ey] = [
          next(),
          next(),
          next(),
          next(),
          next(),
          ox + next(),
          oy + next(),
        ];
        for (const p of arcPoints(
          x,
          y,
          rx!,
          ry!,
          rot!,
          !!large,
          !!sweep,
          ex,
          ey,
        ))
          out.push({ type: 'L', values: [p[0], p[1]] });
        x = ex;
        y = ey;
        lastCtrl = null;
        break;
      }
      default:
        throw new Error(`Unknown path command ${cmd}`);
    }
    lastType = C;
  }
  return out;
}

/** An elliptical arc (SVG's endpoint form) as points along it, the end included. */
function arcPoints(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  rotationDeg: number,
  large: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): Point[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [[x2, y2]];
  const phi = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * y1p) / ry;
  const cyp = (-k * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = angle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );
  if (!sweep && dt > 0) dt -= Math.PI * 2;
  if (sweep && dt < 0) dt += Math.PI * 2;
  const steps = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI / 16)));
  const points: Point[] = [];
  for (let s = 1; s <= steps; s++) {
    const t = t1 + (dt * s) / steps;
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    points.push([cx + cos * ex - sin * ey, cy + sin * ex + cos * ey]);
  }
  return points;
}

/** a b c d e f, as SVG's matrix(a b c d e f). */
type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

const apply = (m: Matrix, [x, y]: Point): Point => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

function parseTransform(t: string | undefined): Matrix {
  let m: Matrix = IDENTITY;
  if (!t) return m;
  for (const [, fn, args] of t.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const v = numbers(args!);
    let n: Matrix = IDENTITY;
    switch (fn) {
      case 'matrix':
        if (v.length === 6) n = v as unknown as Matrix;
        break;
      case 'translate':
        n = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
        break;
      case 'scale':
        n = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const a = ((v[0] ?? 0) * Math.PI) / 180;
        const r: Matrix = [
          Math.cos(a),
          Math.sin(a),
          -Math.sin(a),
          Math.cos(a),
          0,
          0,
        ];
        n =
          v.length === 3
            ? multiply(multiply([1, 0, 0, 1, v[1]!, v[2]!], r), [
                1,
                0,
                0,
                1,
                -v[1]!,
                -v[2]!,
              ])
            : r;
        break;
      }
      case 'skewX':
        n = [1, 0, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        n = [1, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = multiply(m, n);
  }
  return m;
}
