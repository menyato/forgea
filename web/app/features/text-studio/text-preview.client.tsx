import '~/features/model-viewer/three-console.client';
import {
  buildDesign,
  type BuiltDesign,
  designProblem,
  FontSet,
  type TextSettings,
} from '@forgea/text3d';
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
import { useSceneColors } from '~/features/model-viewer/theme-colors';

/** One HarfBuzz font set for the page; each font file is fetched once. */
let fonts: Promise<FontSet> | undefined;
const fetched = new Map<string, Promise<void>>();

async function fontsFor(
  offer: ProductTextOffer,
  ids: readonly string[],
): Promise<FontSet> {
  const set = await (fonts ??= FontSet.load([]));
  await Promise.all(
    ids.map((id) => {
      let loading = fetched.get(id);
      if (!loading) {
        const font = offer.fonts.find((f) => f.id === id);
        loading = font
          ? fetch(`/media/${font.fileKey}`)
              .then((r) => {
                if (!r.ok) throw new Error(`Font ${font.name} didn't load`);
                return r.arrayBuffer();
              })
              .then((b) => set.add([{ id, bytes: new Uint8Array(b) }]))
          : Promise.reject(new Error('Unknown font'));
        // A failed download may be tried again.
        loading.catch(() => fetched.delete(id));
        fetched.set(id, loading);
      }
      return loading;
    }),
  );
  return set;
}

/** The product's settings at the size chosen (the widest piece grows with it), as the API does. */
const settingsOf = (
  offer: ProductTextOffer,
  heightMm: string | undefined,
): TextSettings => {
  const base = Number(offer.letterHeightMm);
  const h = heightMm === undefined ? base : Number(heightMm);
  return {
    style: offer.style,
    maxChars: offer.maxChars,
    letterHeightMm: h,
    letterDepthMm: Number(offer.letterDepthMm),
    baseDepthMm: Number(offer.baseDepthMm),
    maxWidthMm: (Number(offer.maxWidthMm) * h) / base,
    ...(offer.decor ? { decor: offer.decor } : {}),
  };
};

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
    // A moment after the last keystroke.
    const timer = setTimeout(() => {
      const ids = [
        d.fontId,
        ...(d.accentFontId ? [d.accentFontId] : []),
        ...(d.letters ?? []).flatMap((l) => l.fontId ?? []),
      ];
      fontsFor(offer, ids)
        .then((set) => {
          if (cancelled) return;
          const settings = settingsOf(offer, d.heightMm);
          const problem = designProblem(set, d, settings);
          onProblem(problem);
          if (problem) return;
          const next = buildDesign(set, d, settings);
          setBuilt((old) => {
            for (const p of old?.parts ?? []) p.geometry.dispose();
            return next;
          });
          onMeasured?.(key, {
            parts: next.parts.map((p) => ({
              colour: p.colour,
              volumeMm3: p.volumeMm3,
            })),
            size: { x: next.size.x, y: next.size.y, z: next.size.z },
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
