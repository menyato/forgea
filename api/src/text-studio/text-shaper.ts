import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import {
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { TextDesign, TextSettings } from '@forgea/text3d';
import type { TextJob, TextResult } from './text-worker.js';

/** A design is a few letters: far less than this, unless something is wrong (or hostile). */
const TIME_LIMIT_MS = 10_000;
/** Jobs allowed to wait; beyond it new ones are turned away ("try again in a moment"). */
const MAX_WAITING = 200;
/** Workers: two where the server has the cores for it (one core stays with the API). */
const WORKERS = Math.max(1, Math.min(2, availableParallelism() - 1));
/** Designs measured lately (checkout, reorders, and pages whose browser couldn't build it). */
const CACHE_SIZE = 2000;

/** A font for a job: its bytes are read only if the worker doesn't have it yet. */
export interface FontRef {
  id: string;
  read: () => Promise<Uint8Array>;
}

export type Measured =
  | { problem: string }
  | {
      problem: null;
      parts: { colour: string; volumeMm3: number }[];
      size: { x: number; y: number; z: number };
    };

/** A job as asked for: its fonts are sent to whichever worker takes it, if it lacks them. */
type Job =
  | { task: 'warm' }
  | { task: 'scripts'; bytes: Uint8Array }
  | {
      task: 'measure' | 'stl';
      fonts: readonly FontRef[];
      design: TextDesign;
      settings: TextSettings;
    };

interface Slot {
  worker: Worker | undefined;
  /** Fonts this worker already has. */
  sent: Set<string>;
  /** The job it is on, if any. */
  busy: {
    id: number;
    done: (r: TextResult) => void;
    timer: NodeJS.Timeout;
  } | null;
}

/**
 * Runs @forgea/text3d (font reading with HarfBuzz, building solids) in long-lived worker
 * threads, off the API's main thread: however slow or hostile a font or a design is, the API
 * keeps answering. Jobs queue here and go to a worker only when it is free, so each job's
 * time limit counts its own work; one over the limit ends that worker (a fresh one replaces
 * it). Fonts are sent to each worker once. Measured designs are remembered for a while.
 */
@Injectable()
export class TextShaper implements OnApplicationBootstrap, OnModuleDestroy {
  timeLimitMs = TIME_LIMIT_MS;
  private readonly slots: Slot[] = Array.from({ length: WORKERS }, () => ({
    worker: undefined,
    sent: new Set<string>(),
    busy: null,
  }));
  private readonly queue: { job: Job; done: (r: TextResult) => void }[] = [];
  private readonly measured = new Map<string, Measured>();
  private next = 1;

  /** The workers start with the API: the first customer doesn't wait for them. */
  onApplicationBootstrap(): void {
    for (let i = 0; i < this.slots.length; i++)
      void this.send({ task: 'warm' });
  }

  onModuleDestroy(): void {
    for (const slot of this.slots) this.stop(slot, 'The server is stopping');
    for (const q of this.queue.splice(0))
      q.done({ id: 0, ok: false, message: 'The server is stopping' });
  }

  /** A font file's name and the scripts it writes (checked when it is uploaded). */
  async scripts(
    bytes: Uint8Array,
  ): Promise<{ name: string; latin: boolean; arabic: boolean } | null> {
    const r = await this.send({ task: 'scripts', bytes });
    return r.ok && 'scripts' in r ? r.scripts : null;
  }

  /** The design's solids by colour (volumes, mm³) and size, or why it can't be made. */
  async measure(
    fonts: readonly FontRef[],
    design: TextDesign,
    settings: TextSettings,
  ): Promise<Measured> {
    // Fonts never change once added (a new file is a new font), so the design says it all.
    const key = JSON.stringify([design, settings]);
    const known = this.measured.get(key);
    if (known) {
      // Most recently used last: the oldest go first when the cache is full.
      this.measured.delete(key);
      this.measured.set(key, known);
      return known;
    }
    const result = toMeasured(
      await this.send({ task: 'measure', fonts, design, settings }),
    );
    this.measured.set(key, result);
    if (this.measured.size > CACHE_SIZE)
      this.measured.delete(this.measured.keys().next().value!);
    return result;
  }

  /** The print files, one STL per colour, or why the design can't be made. */
  async stl(
    fonts: readonly FontRef[],
    design: TextDesign,
    settings: TextSettings,
  ): Promise<{ problem: string } | { colour: string; bytes: Uint8Array }[]> {
    const r = await this.send({ task: 'stl', fonts, design, settings });
    const m = toMeasured(r);
    if (m.problem !== null) return { problem: m.problem };
    return 'files' in r && r.ok && r.files ? r.files : [];
  }

  private send(job: Job): Promise<TextResult> {
    if (this.queue.length >= MAX_WAITING) {
      throw new ServiceUnavailableException(
        'Busy making other pieces; try again in a moment',
      );
    }
    return new Promise<TextResult>((done) => {
      this.queue.push({ job, done });
      this.dispatch();
    });
  }

  /** Hands queued jobs to free workers. */
  private dispatch(): void {
    for (const slot of this.slots) {
      if (slot.busy || this.queue.length === 0) continue;
      const { job, done } = this.queue.shift()!;
      void this.start(slot, job, done);
    }
  }

  private async start(
    slot: Slot,
    job: Job,
    done: (r: TextResult) => void,
  ): Promise<void> {
    const id = this.next++;
    const timer = setTimeout(() => {
      this.stop(slot, 'This took too long to make');
      this.dispatch();
    }, this.timeLimitMs);
    slot.busy = { id, done, timer };
    try {
      const worker = this.workerFor(slot);
      let message: TextJob;
      if (job.task === 'measure' || job.task === 'stl') {
        const fonts = await Promise.all(
          job.fonts
            .filter((f) => !slot.sent.has(f.id))
            .map(async (f) => ({ id: f.id, bytes: await f.read() })),
        );
        for (const f of fonts) slot.sent.add(f.id);
        message = { ...job, id, fonts };
      } else if (job.task === 'scripts') {
        message = { id, task: 'scripts', bytes: job.bytes };
      } else {
        message = { id, task: 'warm' };
      }
      // Stopped while its fonts were read: the job has already been answered.
      if (slot.busy?.id === id) worker.postMessage(message);
    } catch (error) {
      this.finish(slot, {
        id,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private finish(slot: Slot, r: TextResult): void {
    const busy = slot.busy;
    if (!busy || busy.id !== r.id) return;
    clearTimeout(busy.timer);
    slot.busy = null;
    busy.done(r);
    this.dispatch();
  }

  private workerFor(slot: Slot): Worker {
    if (slot.worker) return slot.worker;
    // The compiled API runs the compiled worker; the tests run from the sources (tsx).
    const fromSource = import.meta.url.endsWith('.ts');
    const worker = new Worker(
      new URL(`./text-worker.${fromSource ? 'ts' : 'js'}`, import.meta.url),
      {
        execArgv: fromSource ? ['--import', 'tsx'] : [],
        resourceLimits: { maxOldGenerationSizeMb: 512 },
      },
    );
    worker.on('message', (r: TextResult) => this.finish(slot, r));
    worker.on('error', (error) => {
      this.stop(slot, error.message);
      this.dispatch();
    });
    worker.on('exit', () => {
      if (slot.worker === worker) {
        this.stop(slot, 'The text worker stopped');
        this.dispatch();
      }
    });
    // An idle worker never keeps the process alive.
    worker.unref();
    slot.worker = worker;
    slot.sent = new Set();
    return worker;
  }

  /** Ends a worker; the job it was on fails with `message` (a fresh worker takes the next). */
  private stop(slot: Slot, message: string): void {
    const worker = slot.worker;
    slot.worker = undefined;
    slot.sent = new Set();
    const busy = slot.busy;
    slot.busy = null;
    if (busy) {
      clearTimeout(busy.timer);
      busy.done({ id: busy.id, ok: false, message });
    }
    if (worker) void worker.terminate();
  }
}

function toMeasured(r: TextResult): Measured {
  if (!r.ok) throw new ServiceUnavailableException(r.message);
  if ('problem' in r) return { problem: r.problem };
  if ('parts' in r) return { problem: null, parts: r.parts, size: r.size };
  throw new Error('Unexpected answer from the text worker');
}
