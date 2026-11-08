// Worker thread for ModelOptimizer: one job (a model's compressed copies, or an STL's volume),
// then it exits. Runs off the API's main thread, so a model that takes long (or a hostile
// one) never stalls requests; ModelOptimizer ends it after a time limit, which also frees all
// its memory.
import { parentPort, workerData } from 'node:worker_threads';
import {
  makeVariants,
  measureVolume,
  threeMfInfo,
} from './model-processing.js';

const job = workerData as
  | { task: 'variants'; data: Uint8Array; extension: string }
  | { task: 'volume'; data: Uint8Array }
  | { task: 'info'; data: Uint8Array };

const run = async () => {
  if (job.task === 'info') {
    parentPort!.postMessage({ ok: true, info: threeMfInfo(job.data) });
    return;
  }
  if (job.task === 'volume') {
    parentPort!.postMessage({ ok: true, volumeMm3: measureVolume(job.data) });
    return;
  }
  const { view, lite } = await makeVariants(job.data, job.extension);
  // The same bytes for both copies of a GLB: send them once.
  const buffers = view === lite ? [view.buffer] : [view.buffer, lite.buffer];
  parentPort!.postMessage({ ok: true, view, lite }, buffers as ArrayBuffer[]);
};

run().catch((error: unknown) => {
  // The file itself was refused (bad, hostile or too big): final, not worth retrying.
  parentPort!.postMessage({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  });
});
