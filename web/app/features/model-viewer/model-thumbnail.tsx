import { useEffect, useRef, useState } from 'react';
import { PrintingLogo } from '~/components/brand/printing-logo';
import { prefersReducedMotion } from './model-viewer';
import { useSceneColors } from './theme-colors';
// Types only: the renderer itself (and three.js) loads when a card scrolls into view.
import type {
  PreparedModel,
  ThumbnailRenderer,
} from './thumbnail-renderer.client';

interface Loaded {
  renderer: ThumbnailRenderer;
  model: PreparedModel;
}

/** Radians per millisecond while the card is hovered: a slow turntable. */
const TURN_SPEED = 0.0012;

/**
 * A product's 3D model, standing on its print plate, drawn into a plain canvas — so every
 * card in the shop shows the real object. It loads when the card scrolls near the screen,
 * and turns while `turning` (the card is hovered or focused) unless motion is reduced.
 */
export function ModelThumbnail({
  modelKey,
  color,
  turning,
  fallback,
}: {
  modelKey: string;
  color: string;
  turning: boolean;
  /** Shown when the model can't be drawn (no WebGL, failed download). */
  fallback: React.ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const loaded = useRef<Loaded | null>(null);
  const angle = useRef(0);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const colors = useSceneColors();

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        import('./thumbnail-renderer.client')
          .then(async ({ thumbnailRenderer }) => {
            const renderer = thumbnailRenderer();
            const model = await renderer.prepare(modelKey, color);
            if (cancelled) return;
            loaded.current = { renderer, model };
            setState('ready');
          })
          .catch(() => {
            if (!cancelled) setState('failed');
          });
      },
      { rootMargin: '300px' },
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [modelKey, color]);

  useEffect(() => {
    const el = canvas.current;
    const ready = loaded.current;
    if (state !== 'ready' || !el || !ready) return;
    const draw = () =>
      ready.renderer.draw(el, ready.model, angle.current, colors);
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      el.width = Math.round(el.clientWidth * dpr);
      el.height = Math.round(el.clientHeight * dpr);
      draw();
    };
    const resized = new ResizeObserver(fit);
    resized.observe(el);
    fit();

    let frame = 0;
    if (turning && !prefersReducedMotion()) {
      let last = performance.now();
      const tick = (now: number) => {
        angle.current += (now - last) * TURN_SPEED;
        last = now;
        draw();
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
    };
  }, [state, colors, turning]);

  return (
    <div className="relative h-full w-full">
      {state === 'failed' ? (
        fallback
      ) : (
        <>
          {state === 'loading' && (
            <span className="absolute inset-0 grid place-items-center">
              <PrintingLogo mode="loop" className="w-10 opacity-70" />
            </span>
          )}
          <canvas
            ref={canvas}
            aria-hidden="true"
            className={`h-full w-full transition-opacity duration-300 ${state === 'ready' ? 'opacity-100' : 'opacity-0'}`}
          />
        </>
      )}
    </div>
  );
}
