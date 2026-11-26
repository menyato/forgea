import type { BufferGeometry } from 'three';
import type { Result, Solid, Task } from './tasks';

/** One worker for the page, made on first use; null where workers can't run. */
let worker: Worker | null | undefined;
let nextId = 0;
const waiting = new Map<
  number,
  { resolve: (r: unknown) => void; reject: (e: Error) => void; task: Task }
>();

function text3dWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./text3d.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = ({
      data,
    }: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const w = waiting.get(data.id);
      waiting.delete(data.id);
      if (!w) return;
      if (data.error === undefined) w.resolve(data.result);
      else w.reject(new Error(data.error));
    };
    // A worker that can't start or crashed: the page does the work itself from then on, and
    // what was waiting is done here.
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      for (const [, w] of waiting) onPage(w.task).then(w.resolve, w.reject);
      waiting.clear();
    };
  } catch {
    worker = null;
  }
  return worker;
}

const onPage = async (task: Task) => (await import('./tasks')).run(task);

/** The task's result, worked out in the worker (or on the page where there is none). */
export function text3d<T extends Task>(task: T): Promise<Result<T>> {
  const w = text3dWorker();
  if (!w) return onPage(task) as Promise<Result<T>>;
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (r: unknown) => void, reject, task });
    w.postMessage({ id, task });
  });
}

/** A solid back as three.js geometry, to draw. */
export async function geometryOf(s: Solid): Promise<BufferGeometry> {
  const { BufferGeometry, Float32BufferAttribute } = await import('three');
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(s.position, 3));
  g.setAttribute('normal', new Float32BufferAttribute(s.normal, 3));
  return g;
}
