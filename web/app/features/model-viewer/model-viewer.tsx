import {
  Component,
  lazy,
  type ReactNode,
  Suspense,
  useSyncExternalStore,
} from 'react';

export interface ModelMeasurement {
  volumeMm3: number;
  sizeMm: [number, number, number];
  /** Where it sits, in the model file's millimetres (Z up): text is placed on its faces. */
  box: { min: [number, number, number]; max: [number, number, number] };
}

/** A solid shown on the model (a slot's text or logo), in the model file's millimetres, Z up. */
export interface ModelExtra {
  geometry: import('three').BufferGeometry;
  color: string;
}

/** A spot clicked on the model: where, and out of which face, in the file's millimetres. */
export interface ModelPick {
  origin: [number, number, number];
  normal: [number, number, number];
  /**
   * The model's triangles in the same frame (x, y, z per corner), read only when asked: the
   * slots editor records the flat face under the click from them.
   */
  triangles: () => Float32Array;
}

import { PrintingLogo } from '~/components/brand/printing-logo';
import { modelSource } from './model-source';

// three.js is large: it loads only when a page shows a model, and only in the browser.
const ModelScene = lazy(() => import('./model-scene.client'));

const subscribe = () => () => {};
/** False during server rendering and hydration, true afterwards. */
export const useHydrated = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * An interactive 3D view of a product model (STL or GLB): drag to turn, scroll or pinch to
 * zoom. Pass the object key; the file is loaded through the storefront's /media route.
 */
export function ModelViewer({
  modelKey,
  label,
  color = '#b87333',
  recolour,
  onMeasured,
  extras,
  onPick,
  className = '',
}: {
  modelKey: string;
  /** What the model shows, for screen readers. */
  label: string;
  color?: string | undefined;
  /** A multi-colour (3MF) model's parts in other colours: file colour → chosen colour. */
  recolour?: Readonly<Record<string, string>> | undefined;
  onMeasured?: ((m: ModelMeasurement) => void) | undefined;
  /** Text and logos to show on it, placed in the model file's frame. */
  extras?: readonly ModelExtra[] | undefined;
  /** Called with the spot clicked on the model (the dashboard places text there). */
  onPick?: ((pick: ModelPick) => void) | undefined;
  className?: string;
}) {
  const hydrated = useHydrated();
  const placeholder = (
    <div className="grid h-full place-content-center justify-items-center gap-3 text-sm text-text-muted">
      <PrintingLogo mode="loop" className="w-14" />
      Loading 3D view…
    </div>
  );
  return (
    <div
      role="img"
      aria-label={`3D view of ${label}. Drag sideways to turn it, scroll or pinch to zoom.`}
      className={`relative aspect-square w-full overflow-hidden bg-surface ${className}`}
    >
      {hydrated ? (
        <SceneBoundary key={modelKey}>
          <Suspense fallback={placeholder}>
            <ModelScene
              // The compressed copy, except where the dashboard measures the model: that
              // needs the uploaded file itself.
              {...modelSource(modelKey, onMeasured ? undefined : 'view')}
              color={color}
              recolour={recolour}
              // Turning on its own would move what someone is about to click.
              spin={!prefersReducedMotion() && !onPick}
              onMeasured={onMeasured}
              extras={extras}
              onPick={onPick}
            />
          </Suspense>
        </SceneBoundary>
      ) : (
        placeholder
      )}
    </div>
  );
}

/**
 * A model that can't be loaded (or a browser without WebGL) must never break the page.
 * A class because React has no hook for catching render errors.
 */
export class SceneBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-text-muted">
        The 3D view isn't available on this device.
      </div>
    ) : (
      this.props.children
    );
  }
}
