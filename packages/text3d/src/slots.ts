import type { BufferGeometry } from 'three';
import { Matrix4, Vector3 } from 'three';
import {
  type DesignSlot,
  type LogoShape,
  type SlotChoice,
  slotState,
  slotTextProblem,
} from './design.js';
import { difference, grown, intersection, union } from './clip.js';
import { faceRegions, fitsInside, slotFrame } from './face.js';
import { partGeometry, volumeMm3 } from './geometry.js';
import {
  boundsOf,
  mapRegions,
  pointInPolygon,
  type Region,
} from './outline.js';
import type { FontSet } from './shaper.js';

/** How far a slot reaches into the surface under it, so the two print as one piece (mm). */
const EMBED_MM = 0.4;

/**
 * A slot as it prints: one solid in the model file's frame (mm, Z up), and its volume. A logo
 * in its own colours is one per colour, all with the slot's id.
 */
export interface BuiltSlot {
  slotId: string;
  colour: string;
  geometry: BufferGeometry;
  volumeMm3: number;
}

/**
 * Why the slots can't be made as chosen, in the customer's words, or null: each editable
 * text checked, and every letter in its font.
 */
export function slotsProblem(
  fonts: FontSet,
  slots: readonly DesignSlot[],
  choices: Readonly<Record<string, SlotChoice>>,
): string | null {
  for (const slot of slots) {
    if (slot.kind !== 'TEXT') continue;
    const state = slotState(slot, choices[slot.id]);
    const problem = slotTextProblem(slot, state.text);
    if (problem) return `${slot.label}: ${problem}`;
    if (!state.on) continue;
    if (!fonts.has(state.fontId))
      return `${slot.label}: choose one of the fonts offered`;
    const missing = fonts.missing(state.fontId, state.text);
    if (missing.length)
      return `${slot.label}: this font has no ${missing.join(' ')}, choose another font`;
  }
  return null;
}

/**
 * The slots that show, as solids on the model: text in its font, logos from `logos` (each as
 * `logoRegionsFromSvg` gives it, 1 across), sized to fit, raised along the surface's normal.
 */
export function buildSlots(
  fonts: FontSet,
  slots: readonly DesignSlot[],
  choices: Readonly<Record<string, SlotChoice>>,
  logos: ReadonlyMap<string, LogoShape>,
): BuiltSlot[] {
  const built: BuiltSlot[] = [];
  // Each slot as placed (flat, in its own frame), for the ones after it to keep their gap from.
  const placed: { slot: DesignSlot; regions: Region[] }[] = [];
  for (const slot of slots) {
    const state = slotState(slot, choices[slot.id]);
    if (!state.on) continue;
    const flat = slotRegions(fonts, slot, state, logos, before(slot, placed));
    if (!flat) continue;
    placed.push({ slot, regions: flat.flatMap((f) => f.regions) });
    for (const { colour, regions } of flat) {
      if (regions.length === 0) continue;
      // Raised: from just under the surface (so they print as one piece) to its height.
      // Flush: sunk into the surface, its top a hair above it (so the view shows it, not the
      // surface it shares; 0.01 mm prints the same).
      const flush = slot.relief === 'FLUSH';
      const geometry = partGeometry({
        colour,
        regions,
        z0: flush ? -slot.depthMm : -EMBED_MM,
        z1: flush ? 0.01 : slot.depthMm,
      });
      geometry.applyMatrix4(placementMatrix(slot));
      built.push({
        slotId: slot.id,
        colour,
        geometry,
        volumeMm3: volumeMm3(geometry),
      });
    }
  }
  return built;
}

/**
 * The slots placed before this one on the same face (same plane, same way out), in this one's
 * flat frame, grown by its gap; none when it has no gap set or no face recorded.
 */
function before(
  slot: DesignSlot,
  placed: readonly { slot: DesignSlot; regions: Region[] }[],
): Region[] {
  if (!slot.placement.face || slot.gapMm === undefined || placed.length === 0)
    return [];
  const mine = slotFrame(slot.placement);
  const out: Region[] = [];
  for (const other of placed) {
    const theirs = slotFrame(other.slot.placement);
    if (theirs.n.dot(mine.n) < 0.99) continue;
    if (Math.abs(theirs.origin.clone().sub(mine.origin).dot(mine.n)) > 1)
      continue;
    const p = new Vector3();
    out.push(
      ...mapRegions(other.regions, ([x, y]) => {
        p.copy(theirs.origin)
          .addScaledVector(theirs.r, x)
          .addScaledVector(theirs.u, y)
          .sub(mine.origin);
        return [p.dot(mine.r), p.dot(mine.u)];
      }),
    );
  }
  return out.length ? grown(union(out), slot.gapMm) : [];
}

/**
 * The slot's flat outline (mm), centred on 0, 0, sized to its height and width, by colour: a
 * logo in its own colours is its outline in the first colour, less the other colours' areas,
 * each in its own (side by side, never overlapping).
 */
function slotRegions(
  fonts: FontSet,
  slot: DesignSlot,
  state: ReturnType<typeof slotState>,
  logos: ReadonlyMap<string, LogoShape>,
  others: readonly Region[] = [],
): { colour: string; regions: Region[] }[] | null {
  let regions: Region[];
  let unitHeight: number;
  let inks: Region[][] = [];
  if (slot.kind === 'TEXT') {
    if (!state.text || !fonts.has(state.fontId)) return null;
    const shaped = fonts.shape(state.fontId, state.text);
    regions = shaped.regions;
    unitHeight = shaped.referenceHeight;
  } else {
    const logo = state.logoId ? logos.get(state.logoId) : undefined;
    if (!logo) return null;
    regions = [...logo.outline];
    const b = boundsOf(regions);
    unitHeight = b ? b.maxY - b.minY : 0;
    if (
      logo.inks &&
      logo.inks.length >= 2 &&
      state.logoColours?.length === logo.inks.length
    )
      inks = logo.inks.slice(1).map((i) => i.regions);
  }
  const b = boundsOf(regions);
  if (!b || unitHeight <= 0) return null;
  let k = slot.heightMm / unitHeight;
  const width = (b.maxX - b.minX) * k;
  if (width > slot.maxWidthMm) k *= slot.maxWidthMm / width;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  let [dx, dy] = [0, 0];
  const at = (r: readonly Region[], s: number) =>
    mapRegions(r, ([x, y]) => [(x - cx) * s + dx, (y - cy) * s + dy]);
  // On a recorded face: smaller until it sits inside it, `edgeMm` from its edge (never off the
  // edge of the print, nor over a border drawn round it) and `gapMm` from what stands in front
  // of it and the slots before it, and when that leaves it much smaller where it was clicked,
  // moved to where on the face it fits largest (a click near the edge of a narrow face).
  // Centred: across the free part of its row, wherever along it the owner clicked.
  const whole = faceRegions(
    slot.placement,
    slot.placement.face,
    slot.edgeMm,
    slot.gapMm ?? 0,
  );
  const face = whole && others.length ? difference(whole, others) : whole;
  const across = (y: number, s: number, near: number): number => {
    if (!face || !slot.centred) return near;
    const half = ((b.maxY - b.minY) * s) / 2;
    const fb = boundsOf(face)!;
    const band = [
      {
        outer: [
          [fb.minX - 1, y - half],
          [fb.maxX + 1, y - half],
          [fb.maxX + 1, y + half],
          [fb.minX - 1, y + half],
        ] as [number, number][],
        holes: [],
      },
    ];
    const spans = intersection(face, band)
      .map((g) => boundsOf([g]))
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (spans.length === 0) return near;
    const span =
      spans.find((s_) => s_.minX <= near && near <= s_.maxX) ??
      spans.reduce((w, s_) => (s_.maxX - s_.minX > w.maxX - w.minX ? s_ : w));
    return (span.minX + span.maxX) / 2;
  };
  if (face && slot.centred) dx = across(0, k, 0);
  if (face && !fitsInside(at(regions, k), face)) {
    const largest = (ox: number, oy: number, steps: number) => {
      [dx, dy] = [ox, oy];
      let [lo, hi] = [0, k];
      for (let i = 0; i < steps; i++) {
        const mid = (lo + hi) / 2;
        if (fitsInside(at(regions, mid), face)) lo = mid;
        else hi = mid;
      }
      return lo;
    };
    let best = { s: largest(dx, 0, 14), x: dx, y: 0 };
    // Centred: the row's middle again for the smaller size (the free span may change with it).
    for (let i = 0; i < 2 && slot.centred; i++) {
      const x = across(0, best.s, best.x);
      best = { s: largest(x, 0, 14), x, y: 0 };
    }
    const fb = boundsOf(face);
    if (fb && best.s < k * 0.9) {
      const n = 9;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const y = fb.minY + ((j + 0.5) / n) * (fb.maxY - fb.minY);
          const x = slot.centred
            ? across(y, best.s, fb.minX + ((i + 0.5) / n) * (fb.maxX - fb.minX))
            : fb.minX + ((i + 0.5) / n) * (fb.maxX - fb.minX);
          if (!face.some((g) => pointInPolygon([x, y], g.outer))) continue;
          const s = largest(x, y, 10);
          // A clearly better spot only: the owner's click wins a near tie.
          if (s > best.s * 1.08) best = { s, x, y };
        }
      if (best.y !== 0 || !slot.centred) best.s = largest(best.x, best.y, 14);
    }
    [dx, dy] = [best.x, best.y];
    if (best.s <= 0) return null;
    k = best.s;
  }
  const place = (r: readonly Region[]) => at(r, k);
  if (inks.length === 0)
    return [{ colour: state.colour, regions: place(regions) }];
  // Each colour over the ones before it (as the logo is drawn).
  const placed = inks.map(place);
  const colours = state.logoColours!;
  return [
    { colour: colours[0]!, regions: difference(place(regions), placed.flat()) },
    ...placed.map((r, i) => ({
      colour: colours[i + 1]!,
      regions: difference(r, placed.slice(i + 1).flat()),
    })),
  ];
}

/**
 * From the slot's own flat frame (x along the text, y up the letters, z out of the surface) to
 * the model's: the text faces along `normal`, upright along `up` as far as the face allows.
 */
export function placementMatrix(slot: DesignSlot): Matrix4 {
  const { origin, r, u, n } = slotFrame(slot.placement);
  return new Matrix4().makeBasis(r, u, n).setPosition(origin);
}
