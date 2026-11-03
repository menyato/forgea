// Worker thread for TextShaper: reads fonts (HarfBuzz, WebAssembly) and turns designs into
// solids, off the API's main thread. Long-lived, one job at a time; TextShaper ends it when a
// job takes too long, which also frees its memory. Fonts arrive once each and stay loaded.
import { parentPort } from 'node:worker_threads';
import type { FontSource, TextDesign, TextSettings } from '@forgea/text3d';

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
  fonts ??= t.FontSet.load([]);
  const set = await fonts;
  set.add(job.fonts);
  const problem = t.designProblem(set, job.design, job.settings);
  if (problem) return { id: job.id, ok: true, problem };
  const built = t.buildDesign(set, job.design, job.settings);
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
};

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
