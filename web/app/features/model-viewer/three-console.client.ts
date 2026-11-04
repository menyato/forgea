import {
  setConsoleFunction,
  WebGLRenderer,
  type WebGLRendererParameters,
} from 'three';

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

/**
 * Every canvas's renderer (the Canvas `gl` prop): outside development, shaders aren't
 * re-checked after compiling. three.js recommends it for production (each check stalls the
 * GPU), and it stops Windows' shader compiler printing its harmless rounding notes ("Program
 * Info Log … X4122") for every visitor. Set as the renderer is made, before the scene's first
 * shaders compile. Development still checks, so a broken shader shows up while working on it.
 */
export const renderer =
  (options: WebGLRendererParameters = {}) =>
  (defaults: WebGLRendererParameters): WebGLRenderer => {
    const gl = new WebGLRenderer({ ...defaults, ...options });
    gl.debug.checkShaderErrors = import.meta.env.DEV;
    return gl;
  };
