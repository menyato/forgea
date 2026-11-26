import {
  boardLayout,
  boardShapes,
  buildDesign,
  designProblem,
  type Region,
} from '@forgea/text3d';
import type { SlotChoice } from '@forgea/text3d/design';
import type {
  ProductSlotsOffer,
  ProductTextOffer,
  TextDesignInput,
} from '@forgea/types';
import type { BufferGeometry } from 'three';
import { buildOfferSlots } from '~/features/design-slots/slot-geometry.client';
import { fontsFor } from '~/features/text-studio/font-set.client';
import { settingsOf } from '~/features/text-studio/text-settings';

/**
 * The text studio's heavy work (shaping, fitting, booleans, solids), as plain data so it can
 * run in the worker and come back to the page without copying; the page runs the same
 * functions itself where workers can't run.
 */
export interface Solid {
  colour: string;
  position: Float32Array;
  normal: Float32Array;
  volumeMm3?: number;
}

export type Task =
  | {
      kind: 'slots';
      offer: ProductSlotsOffer;
      choices: Record<string, SlotChoice>;
    }
  | { kind: 'design'; offer: ProductTextOffer; design: TextDesignInput }
  | { kind: 'board'; offer: ProductTextOffer; design: TextDesignInput };

export interface SlotsResult {
  problem: string | null;
  solids: Solid[];
}
export interface DesignResult {
  problem: string | null;
  solids: Solid[];
  size: { x: number; y: number; z: number } | null;
}
/** The flat board view: the base, and each item's shape drawn at the middle. */
export interface BoardResult {
  problem: string | null;
  base: Region[];
  items: [string, Region[]][];
}
export type Result<T extends Task> = T['kind'] extends 'slots'
  ? SlotsResult
  : T['kind'] extends 'design'
    ? DesignResult
    : BoardResult;

const solid = (
  colour: string,
  geometry: BufferGeometry,
  volumeMm3?: number,
): Solid => {
  const out: Solid = {
    colour,
    position: geometry.getAttribute('position').array as Float32Array,
    normal: geometry.getAttribute('normal').array as Float32Array,
    ...(volumeMm3 === undefined ? {} : { volumeMm3 }),
  };
  geometry.dispose();
  return out;
};

const fontIds = (d: TextDesignInput) => [
  d.fontId,
  ...(d.accentFontId ? [d.accentFontId] : []),
  ...(d.letters ?? []).flatMap((l) => l.fontId ?? []),
  ...(d.items ?? []).flatMap((i) => i.fontId ?? []),
];

export async function run(
  task: Task,
): Promise<SlotsResult | DesignResult | BoardResult> {
  if (task.kind === 'slots') {
    const { problem, built } = await buildOfferSlots(task.offer, task.choices);
    return { problem, solids: built.map((b) => solid(b.colour, b.geometry)) };
  }
  const { offer, design: d } = task;
  const set = await fontsFor(offer.fonts, fontIds(d));
  const settings = settingsOf(offer, d.heightMm);
  const problem = designProblem(set, d, settings);
  const logos = new Map(offer.logos.map((l) => [l.id, l]));
  if (task.kind === 'design') {
    if (problem) return { problem, solids: [], size: null };
    const built = buildDesign(set, d, settings, logos);
    return {
      problem: null,
      solids: built.parts.map((p) => solid(p.colour, p.geometry, p.volumeMm3)),
      size: { x: built.size.x, y: built.size.y, z: built.size.z },
    };
  }
  if (problem) return { problem, base: [], items: [] };
  const layout = boardLayout(set, d, settings, logos);
  const base = layout.parts
    .filter((p) => p.colour === d.textColour && p.z0 <= 0)
    .flatMap((p) => p.regions);
  // Each item at the middle: the screen moves it, so a drag reshapes nothing.
  const still = boardShapes(
    set,
    { ...d, items: (d.items ?? []).map((i) => ({ ...i, x: 0, y: 0 })) },
    settings,
    logos,
  );
  return {
    problem: null,
    base,
    items: still.items.map((i) => [i.id, i.regions]),
  };
}

/** Every solid's buffers, to move rather than copy across. */
export const transfers = (r: SlotsResult | DesignResult | BoardResult) =>
  'solids' in r
    ? r.solids.flatMap((s) => [s.position.buffer, s.normal.buffer])
    : [];
