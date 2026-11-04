import { setConsoleFunction } from 'three';

/**
 * three.js's own console, minus one notice: @react-three/fiber 9 still creates a THREE.Clock
 * for every canvas, deprecated in three r183 (fiber 10 moves to THREE.Timer; nothing of ours
 * uses Clock). That notice is the only message dropped; every other three.js log, warning and
 * error reaches the console exactly as before. Imported by each module that draws a canvas.
 */
const CLOCK_NOTICE = 'THREE.Clock: This module has been deprecated';

setConsoleFunction((type: string, message: string, ...params: unknown[]) => {
  if (type === 'warn' && message.startsWith(CLOCK_NOTICE)) return;
  const method = type === 'error' || type === 'warn' ? type : 'log';
  const [stack] = params as [
    { isStackTrace?: boolean; getError?: (m: string) => Error } | undefined,
  ];
  // As three.js itself would: a message with a stack trace becomes an Error.
  if (stack?.isStackTrace && stack.getError) {
    console[method](stack.getError(message));
    return;
  }
  console[method](message, ...params);
});
