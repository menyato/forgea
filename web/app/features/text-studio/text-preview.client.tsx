import { renderer } from '~/features/model-viewer/three-console.client';
import type { BuiltDesign } from '@forgea/text3d';
import type {
  DesignMeasurement,
  ProductTextOffer,
  TextDesignInput,
} from '@forgea/types';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { Box3, Color, PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Plate, StudioLight } from '~/features/model-viewer/model-scene.client';
import { geometryOf, text3d } from '~/features/text3d-worker/text3d.client';
import { useSceneColors } from '~/features/model-viewer/theme-colors';

/**
 * The piece as the customer designs it, in 3D: made in the browser by the same code the
 * studio prints from (@forgea/text3d), so what they see is what they get. Laid flat for a
 * keychain or single letters, standing for a name or initials.
 */
export default function TextPreview({
  offer,
  design,
  label,
  onProblem,
  onMeasured,
}: {
  offer: ProductTextOffer;
  design: TextDesignInput;
  label: string;
  onProblem: (problem: string | null) => void;
  /**
   * What was built for this design (its JSON as the key): the page prices from it, so the
   * server never has to build the piece while the customer types.
   */
  onMeasured?: (designJson: string, measured: DesignMeasurement) => void;
}) {
  const [built, setBuilt] = useState<BuiltDesign | null>(null);
  const key = JSON.stringify(design);
  useEffect(() => {
    let cancelled = false;
    const d = JSON.parse(key) as TextDesignInput;
    // A moment after the last keystroke, in the text studio's worker (typing never waits).
    const timer = setTimeout(() => {
      text3d({ kind: 'design', offer, design: d })
        .then(async ({ problem, solids, size }) => {
          if (cancelled) return;
          onProblem(problem);
          if (problem || !size) return;
          const next: BuiltDesign = {
            parts: await Promise.all(
              solids.map(async (s) => ({
                colour: s.colour,
                geometry: await geometryOf(s),
                volumeMm3: s.volumeMm3 ?? 0,
              })),
            ),
            size,
          };
          if (cancelled) {
            for (const p of next.parts) p.geometry.dispose();
            return;
          }
          setBuilt((old) => {
            for (const p of old?.parts ?? []) p.geometry.dispose();
            return next;
          });
          onMeasured?.(key, {
            parts: next.parts.map((p) => ({
              colour: p.colour,
              volumeMm3: p.volumeMm3,
            })),
            size: { x: size.x, y: size.y, z: size.z },
          });
        })
        .catch((error: unknown) => {
          if (!cancelled)
            onProblem(error instanceof Error ? error.message : String(error));
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, offer, onProblem, onMeasured]);
  useEffect(
    () => () => {
      for (const p of built?.parts ?? []) p.geometry.dispose();
    },
    [built],
  );

  const hex = useMemo(
    () => new Map(offer.colours.map((c) => [c.id, c.swatchHex])),
    [offer.colours],
  );
  const lying = offer.style === 'KEYCHAIN' || offer.style === 'LETTERS';
  return (
    <div role="img" aria-label={label} className="h-full w-full">
      <Canvas
        camera={{ fov: 35, near: 0.1, far: 10_000 }}
        dpr={[1, 2]}
        frameloop="demand"
        gl={renderer()}
      >
        <StudioLight />
        <directionalLight position={[2, 4, 3]} intensity={1.4} />
        <directionalLight position={[-3, 2, -4]} intensity={0.9} />
        {/* Framed for the largest size: a bigger size shows bigger. */}
        <Controls radius={largestWidth(offer) * 0.6} lying={lying} />
        {built && <Piece built={built} hex={hex} lying={lying} />}
      </Canvas>
    </div>
  );
}

/** The piece, centred; its plate just under it. */
function Piece({
  built,
  hex,
  lying,
}: {
  built: BuiltDesign;
  hex: Map<string, string | null>;
  lying: boolean;
}) {
  const { accent } = useSceneColors();
  const { invalidate } = useThree();
  const { center, size } = useMemo(() => {
    const box = new Box3();
    for (const p of built.parts) {
      p.geometry.computeBoundingBox();
      box.union(p.geometry.boundingBox!);
    }
    return {
      center: box.getCenter(new Vector3()),
      size: box.getSize(new Vector3()),
    };
  }, [built]);
  useEffect(() => invalidate(), [built, invalidate]);
  return (
    <>
      <Plate
        radius={Math.max(size.x, size.y) * 0.7}
        y={lying ? -size.z / 2 : -size.y / 2}
      />
      <group rotation={lying ? [-Math.PI / 2, 0, 0] : [0, 0, 0]}>
        <group position={[-center.x, -center.y, -center.z]}>
          {built.parts.map((p, i) => (
            <mesh key={i} geometry={p.geometry}>
              <meshStandardMaterial
                color={new Color(hex.get(p.colour) ?? accent)}
                roughness={0.55}
                metalness={0.05}
              />
            </mesh>
          ))}
        </group>
      </group>
    </>
  );
}

/**
 * The camera, set once from the widest the piece may be: it stays put while the customer
 * types. Drag to turn, scroll or pinch to zoom; vertical swipes still scroll a phone's page.
 */
function Controls({ radius, lying }: { radius: number; lying: boolean }) {
  const { camera, gl, invalidate } = useThree();
  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const distance = radius / Math.sin((camera.fov * Math.PI) / 360);
    camera.position.set(
      0,
      distance * (lying ? 0.8 : 0.25),
      distance * (lying ? 0.6 : 1),
    );
    camera.near = distance / 100;
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enableDamping = true;
    controls.minDistance = radius * 0.4;
    controls.maxDistance = distance * 3;
    controls.addEventListener('change', () => invalidate());
    gl.domElement.style.touchAction = 'pan-y';
    let frame = 0;
    const tick = () => {
      controls.update();
      frame = requestAnimationFrame(tick);
    };
    tick();
    invalidate();
    return () => {
      cancelAnimationFrame(frame);
      controls.dispose();
    };
  }, [camera, gl, invalidate, radius, lying]);
  return null;
}

/** The widest the largest size may be (mm). */
function largestWidth(offer: ProductTextOffer): number {
  const base = Number(offer.letterHeightMm);
  const largest = Math.max(base, ...offer.sizesMm.map(Number));
  return (Number(offer.maxWidthMm) * largest) / base;
}
