import { lazy, Suspense } from 'react';
import { PrintingLogo } from '~/components/brand/printing-logo';
import {
  prefersReducedMotion,
  SceneBoundary,
  useHydrated,
} from '~/features/model-viewer/model-viewer';
import type { BuildPlateProps } from './build-plate-scene.client';

const BuildPlateScene = lazy(() => import('./build-plate-scene.client'));

/**
 * The print bed with the studio's models on it. Decorative for screen readers: the same
 * products are listed as links right below it. While three.js loads, the printing logo
 * stands in its place.
 */
export function BuildPlate(props: Omit<BuildPlateProps, 'animate'>) {
  const hydrated = useHydrated();
  const plate = (
    <div className="grid h-full place-items-center">
      <PrintingLogo mode="loop" className="w-20" />
    </div>
  );
  return (
    <div aria-hidden="true" className="relative h-full w-full">
      {hydrated && props.items.length > 0 ? (
        <SceneBoundary>
          <Suspense fallback={plate}>
            <BuildPlateScene {...props} animate={!prefersReducedMotion()} />
          </Suspense>
        </SceneBoundary>
      ) : (
        plate
      )}
    </div>
  );
}
