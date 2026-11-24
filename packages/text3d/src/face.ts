import { Vector3 } from 'three';
import { MAX_FACE_POINTS, type SlotPlacement } from './design.js';
import { difference, grown, union } from './clip.js';
import {
  type Contour,
  type Point,
  pointInPolygon,
  type Region,
  regionsOf,
  signedArea,
} from './outline.js';

/** Faces turned more than this from the clicked one are not part of it (a rounded edge's). */
const FACE_ANGLE_COS = Math.cos((25 * Math.PI) / 180);
/**
 * Nor anything further than this in front of or behind the clicked point, mm: the same flat
 * level only (a step down beside it, as a brake disc beside its caliper, is another face).
 */
const FACE_DEPTH_MM = 0.3;
/** Nor anything further away than this along the surface, mm (big flat models stay quick). */
const FACE_REACH_MM = 250;
/** Text and logos keep this far inside the face's edge, mm. */
const FACE_MARGIN_MM = 0.6;

/** The slot's own frame: x along the text, y up the letters, z out of the surface. */
export function slotFrame(p: SlotPlacement) {
  const n = new Vector3(...p.normal).normalize();
  let u = new Vector3(...p.up);
  // Up made square to the normal; on a face whose normal is "up" itself, the back is up.
  u.sub(n.clone().multiplyScalar(u.dot(n)));
  if (u.lengthSq() < 1e-8)
    u = Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
  u.normalize();
  const r = new Vector3().crossVectors(u, n).normalize();
  return { origin: new Vector3(...p.origin), r, u, n };
}

/**
 * The flat area of the model a slot sits on, as the dashboard records it when the owner clicks
 * a place: every triangle facing (nearly) the same way, near the clicked point, laid flat in
 * the slot's frame and joined; the piece under the click, holes and all. Returned in the model
 * file's frame (mm, each contour as x, y, z, x, y, z…) so it stays right when the text is
 * turned. `positions` are the model's triangles (x, y, z per corner, file frame, mm).
 * Undefined when nothing flat is under the click.
 */
export function faceAround(
  positions: ArrayLike<number>,
  placement: SlotPlacement,
): number[][] | undefined {
  const { origin, r, u, n } = slotFrame(placement);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const ab = new Vector3();
  const ac = new Vector3();
  const triangles: Region[] = [];
  for (let i = 0; i + 8 < positions.length; i += 9) {
    a.set(positions[i]!, positions[i + 1]!, positions[i + 2]!).sub(origin);
    b.set(positions[i + 3]!, positions[i + 4]!, positions[i + 5]!).sub(origin);
    c.set(positions[i + 6]!, positions[i + 7]!, positions[i + 8]!).sub(origin);
    const facing = ab
      .subVectors(b, a)
      .cross(ac.subVectors(c, a))
      .normalize()
      .dot(n);
    if (!(facing >= FACE_ANGLE_COS)) continue;
    if ([a, b, c].some((p) => Math.abs(p.dot(n)) > FACE_DEPTH_MM)) continue;
    const flat: Contour = [a, b, c].map((p) => [p.dot(r), p.dot(u)] as Point);
    if (flat.every(([x, y]) => Math.hypot(x, y) > FACE_REACH_MM)) continue;
    if (Math.abs(signedArea(flat)) < 1e-6) continue;
    triangles.push({ outer: flat, holes: [] });
  }
  if (triangles.length === 0) return undefined;
  // Joined a hair wider, then back, so the seams between triangles close.
  const joined = grown(grown(union(triangles), 0.02), -0.02);
  const under = joined.find(
    (g) =>
      pointInPolygon([0, 0], g.outer) &&
      !g.holes.some((h) => pointInPolygon([0, 0], h)),
  );
  if (!under) return undefined;
  const contours = [under.outer, ...under.holes].map((k) => thinned(k, 0.2));
  const total = contours.reduce((s, k) => s + k.length, 0);
  const step = Math.ceil(total / MAX_FACE_POINTS);
  const lift = ([x, y]: Point) => {
    const p = origin.clone().addScaledVector(r, x).addScaledVector(u, y);
    return [round(p.x), round(p.y), round(p.z)];
  };
  return contours
    .map((k) => (step > 1 ? k.filter((_, i) => i % step === 0) : k))
    .filter((k) => k.length >= 3)
    .map((k) => k.flatMap(lift));
}

/**
 * The slot's face laid flat in its own frame (its outer edge), less the margin: what its text
 * or logo must stay inside. Null when the slot has none recorded.
 */
export function faceRegions(
  placement: SlotPlacement,
  face: readonly (readonly number[])[] | undefined,
): Region[] | null {
  if (!face || face.length === 0) return null;
  const { origin, r, u } = slotFrame(placement);
  const p = new Vector3();
  const contours: Contour[] = face.map((k) => {
    const out: Point[] = [];
    for (let i = 0; i + 2 < k.length; i += 3) {
      p.set(k[i]!, k[i + 1]!, k[i + 2]!).sub(origin);
      out.push([p.dot(r), p.dot(u)]);
    }
    return out;
  });
  // Its outer edge only: a groove, a bolt or a hole inside it is shallow detail the raised
  // letters can cross; only the edge would leave them hanging in the air.
  const outer = regionsOf(contours.filter((k) => k.length >= 3)).map((g) => ({
    outer: g.outer,
    holes: [],
  }));
  const inside = grown(outer, -FACE_MARGIN_MM);
  return inside.length ? inside : null;
}

/** Whether `regions` lie inside `face` (nothing more than a speck sticks out). */
export function fitsInside(
  regions: readonly Region[],
  face: readonly Region[],
): boolean {
  return areaOf(difference(regions, face)) < 0.05;
}

function areaOf(regions: readonly Region[]): number {
  return regions.reduce(
    (s, g) =>
      s +
      Math.abs(signedArea(g.outer)) -
      g.holes.reduce((h, k) => h + Math.abs(signedArea(k)), 0),
    0,
  );
}

/** Points closer than `min` to the last one kept are dropped. */
function thinned(k: Contour, min: number): Contour {
  const out: Point[] = [];
  for (const p of k) {
    const last = out.at(-1);
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= min) out.push(p);
  }
  return out;
}

const round = (v: number) => Math.round(v * 100) / 100;
