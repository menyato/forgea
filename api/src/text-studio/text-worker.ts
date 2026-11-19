// Worker thread for TextShaper: reads fonts (HarfBuzz, WebAssembly) and turns designs into
// solids, off the API's main thread. Long-lived, one job at a time; TextShaper ends it when a
// job takes too long, which also frees its memory. Fonts arrive once each and stay loaded.
import { parentPort } from 'node:worker_threads';
import type {
  DesignSlot,
  FontSource,
  Region,
  SlotChoice,
  TextDesign,
  TextSettings,
} from '@forgea/text3d';

export type TextJob =
  /** Loads HarfBuzz and three.js ahead of the first customer. */
  | { id: number; task: 'warm' }
  | { id: number; task: 'scripts'; bytes: Uint8Array }
  | {
      id: number;
      task: 'measure' | 'stl';
      /** Fonts the worker doesn't have yet (the rest it keeps from before). */
      fonts: FontSource[];
      design: TextDesign;
      settings: TextSettings;
      /** A keychain's logo, as print outlines. */
      logos: [string, Region[]][];
    }
  /** A logo's SVG as print outlines. */
  | { id: number; task: 'logo'; svg: string }
  /** A product's text and logo slots, as chosen: measured, or as print files too. */
  | {
      id: number;
      task: 'slots' | 'slots-stl';
      fonts: FontSource[];
      slots: DesignSlot[];
      choices: Record<string, SlotChoice>;
      logos: [string, Region[]][];
    };

export type TextResult =
  | { id: number; ok: false; message: string }
  | { id: number; ok: true; warm: true }
  | {
      id: number;
      ok: true;
      scripts: { name: string; latin: boolean; arabic: boolean };
    }
  | { id: number; ok: true; problem: string }
  | { id: number; ok: true; outline: Region[]; points: number }
  | {
      id: number;
      ok: true;
      slots: { slotId: string; colour: string; volumeMm3: number }[];
      files?: { slotId: string; colour: string; bytes: Uint8Array }[];
    }
  | {
      id: number;
      ok: true;
      parts: { colour: string; volumeMm3: number }[];
      size: { x: number; y: number; z: number };
      files?: { colour: string; bytes: Uint8Array }[];
    };

const text3d = import('@forgea/text3d');
let fonts: Promise<import('@forgea/text3d').FontSet> | undefined;

const run = async (job: TextJob): Promise<TextResult> => {
  const t = await text3d;
  if (job.task === 'warm') {
    fonts ??= t.FontSet.load([]);
    await fonts;
    return { id: job.id, ok: true, warm: true };
  }
  if (job.task === 'scripts') {
    return { id: job.id, ok: true, scripts: await t.fontScripts(job.bytes) };
  }
  if (job.task === 'logo') {
    const outline = rounded(t.logoRegionsFromSvg(job.svg));
    const points = outline.reduce(
      (n, r) => n + r.outer.length + r.holes.reduce((m, h) => m + h.length, 0),
      0,
    );
    return { id: job.id, ok: true, outline, points };
  }
  fonts ??= t.FontSet.load([]);
  const set = await fonts;
  set.add(job.fonts);
  if (job.task === 'measure' || job.task === 'stl') {
    const problem = t.designProblem(set, job.design, job.settings);
    if (problem) return { id: job.id, ok: true, problem };
    const built = t.buildDesign(
      set,
      job.design,
      job.settings,
      new Map(job.logos),
    );
    return {
      id: job.id,
      ok: true,
      parts: built.parts.map((p) => ({
        colour: p.colour,
        volumeMm3: p.volumeMm3,
      })),
      size: built.size,
      ...(job.task === 'stl'
        ? {
            files: built.parts.map((p) => ({
              colour: p.colour,
              bytes: t.stlBytes(p.geometry, p.colour),
            })),
          }
        : {}),
    };
  }
  if (job.task !== 'slots' && job.task !== 'slots-stl')
    throw new Error('Unknown job');
  const problem = t.slotsProblem(set, job.slots, job.choices);
  if (problem) return { id: job.id, ok: true, problem };
  const built = t.buildSlots(set, job.slots, job.choices, new Map(job.logos));
  return {
    id: job.id,
    ok: true,
    slots: built.map((b) => ({
      slotId: b.slotId,
      colour: b.colour,
      volumeMm3: b.volumeMm3,
    })),
    ...(job.task === 'slots-stl'
      ? {
          files: built.map((b) => ({
            slotId: b.slotId,
            colour: b.colour,
            bytes: t.stlBytes(b.geometry, b.slotId),
          })),
        }
      : {}),
  };
};

/** Coordinates to 5 decimals (a logo is 1 across: a thousandth of a millimetre at 100 mm). */
function rounded(regions: Region[]): Region[] {
  const r = ([x, y]: readonly [number, number]) =>
    [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5] as const;
  return regions.map((g) => ({
    outer: g.outer.map(r),
    holes: g.holes.map((h) => h.map(r)),
  }));
}

parentPort!.on('message', (job: TextJob) => {
  run(job).then(
    (result) => parentPort!.postMessage(result),
    (error: unknown) =>
      parentPort!.postMessage({
        id: job.id,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      } satisfies TextResult),
  );
});
