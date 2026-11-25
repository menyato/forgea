import { Worker } from 'node:worker_threads';
import type { ModelVariant } from '@forgea/validation';
import { Injectable } from '@nestjs/common';
import type { ThreeMfInfo } from './three-mf.js';

/** A model that takes longer than this is refused (a real 100 MB model needs ~20 s). */
const TIME_LIMIT_MS = 90_000;
/** One model at a time: a burst of uploads queues instead of starving the server's CPU. */
const MAX_PARALLEL = 1;
/** Jobs allowed to wait; beyond it new ones are turned away (and made later, on request). */
const MAX_WAITING = 20;

/**
 * The file was refused: bad, hostile, too big, too slow (over the time limit) or too hungry
 * (out of the worker's memory). Final: not worth trying again. Only a full queue is not.
 */
export class ModelRefusedError extends Error {}

type Result =
  | {
      ok: true;
      view?: Uint8Array;
      lite?: Uint8Array;
      volumeMm3?: number | null;
      info?: ThreeMfInfo;
      project?: Uint8Array;
    }
  | { ok: false; message: string };

/** Reads a file's bytes; called only when its job's turn comes, so waiting jobs hold none. */
type Load = () => Promise<Uint8Array>;

/**
 * Runs the work on uploaded 3D files (model-processing.ts) in a worker thread with a time and
 * memory limit, one at a time. However slow or hostile a file is, the API keeps answering
 * requests, and ending the worker gives back all the memory it used (WebAssembly included).
 */
@Injectable()
export class ModelOptimizer {
  /** How long one job may take; tests shorten it. */
  timeLimitMs = TIME_LIMIT_MS;
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  /** The compressed copies of a model. */
  async variants(
    load: Load,
    extension: string,
  ): Promise<Record<ModelVariant, Uint8Array>> {
    const result = await this.run(load, (data) => ({
      task: 'variants',
      data,
      extension,
    }));
    return { view: result.view!, lite: result.lite! };
  }

  /** An STL's volume in mm³, or null when it can't be measured. */
  async volume(load: Load): Promise<number | null> {
    const result = await this.run(load, (data) => ({ task: 'volume', data }));
    return result.volumeMm3 ?? null;
  }

  /** The model (STL or 3MF) with more parts placed on it, as one 3MF project. */
  async project(
    load: Load,
    extension: string,
    title: string,
    extras: { label: string; hex: string | null; stl: Uint8Array }[],
  ): Promise<Uint8Array> {
    const result = await this.run(load, (data) => ({
      task: 'project',
      data,
      extension,
      title,
      extras,
    }));
    return result.project!;
  }

  /**
   * A slicer project with more parts added to its objects (print-ready.ts): the print file with
   * an order's text in place, ready to slice and print. `loadModel` is the shop model whose
   * frames place the parts, or null when the project is the shop model itself. Null when the
   * parts can't be placed (no frames, or a part on no object): the caller falls back.
   */
  async printReady(
    load: Load,
    loadModel: Load | null,
    extras: { label: string; hex: string | null; stl: Uint8Array }[],
  ): Promise<Uint8Array | null> {
    const model = loadModel ? await loadModel() : null;
    const result = await this.run(load, (data) => ({
      task: 'print-ready',
      data,
      model,
      extras,
    }));
    return result.project ?? null;
  }

  /** What a 3MF says about printing it: colours, volumes, the slicer's time and grams. */
  async threeMfInfo(load: Load): Promise<ThreeMfInfo> {
    const result = await this.run(load, (data) => ({ task: 'info', data }));
    return result.info!;
  }

  private async run(
    load: Load,
    job: (data: Uint8Array) => object,
  ): Promise<Extract<Result, { ok: true }>> {
    if (this.waiting.length >= MAX_WAITING) {
      throw new Error('Busy with other 3D files; try again later');
    }
    await this.turn();
    try {
      const result = await runWorker(job(await load()), this.timeLimitMs);
      if (result.ok) return result;
      throw new ModelRefusedError(result.message);
    } finally {
      this.release();
    }
  }

  /** Waits for a free slot; a finished job hands its slot straight to the next in line. */
  private async turn(): Promise<void> {
    if (this.running >= MAX_PARALLEL) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
      return;
    }
    this.running++;
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.running--;
  }
}

function runWorker(workerData: object, timeLimitMs: number): Promise<Result> {
  // The compiled API runs the compiled worker; the tests run from the sources, where the
  // worker is TypeScript, loaded through tsx.
  const fromSource = import.meta.url.endsWith('.ts');
  const worker = new Worker(
    new URL(`./model-worker.${fromSource ? 'ts' : 'js'}`, import.meta.url),
    {
      workerData,
      execArgv: fromSource ? ['--import', 'tsx'] : [],
      resourceLimits: { maxOldGenerationSizeMb: 1024 },
    },
  );
  return new Promise<Result>((resolve) => {
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve({
        ok: false,
        message: 'The model took too long to process',
      });
    }, timeLimitMs);
    const done = (result: Result) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };
    worker.once('message', done);
    worker.once('error', (error) =>
      done({ ok: false, message: error.message }),
    );
    worker.once('exit', (code) =>
      done({
        ok: false,
        message: `The model could not be processed (${code})`,
      }),
    );
  });
}
