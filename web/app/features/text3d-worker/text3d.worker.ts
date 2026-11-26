/// <reference lib="webworker" />
import { run, type Task, transfers } from './tasks';

/** The text studio's heavy work, off the page's main thread: typing never waits for it. */
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async ({
  data,
}: MessageEvent<{ id: number; task: Task }>) => {
  try {
    const result = await run(data.task);
    scope.postMessage({ id: data.id, result }, transfers(result));
  } catch (error) {
    scope.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
