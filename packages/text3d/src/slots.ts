import type { BufferGeometry } from 'three';
import { Matrix4, Vector3 } from 'three';
import {
  type DesignSlot,
  type LogoShape,
  type SlotChoice,
  slotState,
  slotTextProblem,
} from './design.js';
import { difference } from './clip.js';
import { partGeometry, volumeMm3 } from './geometry.js';
import { boundsOf, mapRegions, type Region } from './outline.js';
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
  for (const slot of slots) {
    const state = slotState(slot, choices[slot.id]);
    if (!state.on) continue;
    const flat = slotRegions(fonts, slot, state, logos);
    if (!flat) continue;
    for (const { colour, regions } of flat) {
      if (regions.length === 0) continue;
      const geometry = partGeometry({
        colour,
        regions,
        z0: -EMBED_MM,
        z1: slot.depthMm,
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
 * The slot's flat outline (mm), centred on 0, 0, sized to its height and width, by colour: a
 * logo in its own colours is its outline in the first colour, less the other colours' areas,
 * each in its own (side by side, never overlapping).
 */
function slotRegions(
  fonts: FontSet,
  slot: DesignSlot,
  state: ReturnType<typeof slotState>,
  logos: ReadonlyMap<string, LogoShape>,
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
  const place = (r: readonly Region[]) =>
    mapRegions(r, ([x, y]) => [(x - cx) * k, (y - cy) * k]);
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
  const { origin, normal, up } = slot.placement;
  const n = new Vector3(...normal).normalize();
  let u = new Vector3(...up);
  // Up made square to the normal; on a face whose normal is "up" itself, the back is up.
  u.sub(n.clone().multiplyScalar(u.dot(n)));
  if (u.lengthSq() < 1e-8)
    u = Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
  u.normalize();
  const r = new Vector3().crossVectors(u, n).normalize();
  return new Matrix4().makeBasis(r, u, n).setPosition(new Vector3(...origin));
}
