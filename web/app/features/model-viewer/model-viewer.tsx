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
  onMeasured,
  className = '',
}: {
  modelKey: string;
  /** What the model shows, for screen readers. */
  label: string;
  color?: string | undefined;
  onMeasured?: ((m: ModelMeasurement) => void) | undefined;
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
              spin={!prefersReducedMotion()}
              onMeasured={onMeasured}
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
