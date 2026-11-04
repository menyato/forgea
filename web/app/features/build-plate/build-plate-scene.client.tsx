import { renderer } from '~/features/model-viewer/three-console.client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box3,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  type LineBasicMaterial,
  type LineLoop,
  type Material,
  Mesh,
  type Object3D,
  PerspectiveCamera,
  Plane,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  loadModel,
  paint,
  studioEnvironment,
} from '~/features/model-viewer/model-assets.client';
import { useSceneColors } from '~/features/model-viewer/theme-colors';

export interface PlateItem {
  slug: string;
  name: string;
  modelKey: string;
  color: string;
}

export interface BuildPlateProps {
  /** In bed order: the first stands in the centre, the next four in the corners. */
  items: readonly PlateItem[];
  /** Print the models layer by layer when the scene opens (off for reduced motion). */
  animate: boolean;
  hovered: string | null;
  onHover: (slug: string | null) => void;
  onOpen: (slug: string) => void;
}

/** A 256 × 256 mm bed, like a common desktop printer; models stand on it at real size. */
const PLATE = 256;
/** The centre piece and the corner pieces are scaled down (never up) to fit their spot. */
const CENTRE_SLOT = 110;
const CORNER_SLOT = 72;
const CORNER = 88;
const CORNERS = [
  [-CORNER, -CORNER],
  [CORNER, -CORNER],
  [-CORNER, CORNER],
  [CORNER, CORNER],
] as const;

/**
 * When each spot prints (seconds after every model has loaded): the centre first, then the
 * corners together. Layers rise at a steady speed, as on a printer.
 */
const CENTRE_PRINT = { start: 0, seconds: 2.2 };
const CORNERS_PRINT = { start: 1.8, seconds: 2.8 };
const PRINT_END = CORNERS_PRINT.start + CORNERS_PRINT.seconds;
/** If a model never arrives, print the rest anyway after this long. */
const LOAD_PATIENCE_MS = 6000;

/** The home page's print bed. Imported lazily, in the browser only. */
export default function BuildPlateScene(props: BuildPlateProps) {
  const items = props.items.slice(0, 1 + CORNERS.length);
  const [printing, setPrinting] = useState(props.animate);
  const [ready, setReady] = useState(0);
  const [patienceOver, setPatienceOver] = useState(false);
  const onReady = useCallback(() => setReady((n) => n + 1), []);
  useEffect(() => {
    const timer = setTimeout(() => setPatienceOver(true), LOAD_PATIENCE_MS);
    return () => clearTimeout(timer);
  }, []);
  // The clock starts once everything is on the bed, so no model pops in half-printed.
  const started = printing && (ready >= items.length || patienceOver);

  return (
    <Canvas
      camera={{ fov: 30, near: 5, far: 5000 }}
      dpr={[1, 2]}
      gl={renderer({ antialias: true, alpha: true })}
      onCreated={({ gl }) => {
        gl.localClippingEnabled = true;
      }}
      // Animates only while printing; afterwards it renders when the visitor turns the bed.
      frameloop={printing ? 'always' : 'demand'}
      onPointerMissed={() => props.onHover(null)}
    >
      <Studio />
      <directionalLight position={[120, 300, 200]} intensity={1.5} />
      <directionalLight position={[-200, 150, -260]} intensity={0.8} />
      <Rig />
      <Bed />
      {items.map((item, i) => (
        <PrintedModel
          key={item.modelKey}
          item={item}
          at={i === 0 ? [0, 0] : CORNERS[i - 1]!}
          slot={i === 0 ? CENTRE_SLOT : CORNER_SLOT}
          phase={i === 0 ? CENTRE_PRINT : CORNERS_PRINT}
          printing={printing}
          lifted={props.hovered === item.slug}
          onReady={onReady}
          onHover={props.onHover}
          onOpen={props.onOpen}
        />
      ))}
      {started && <PrintClock onDone={() => setPrinting(false)} />}
    </Canvas>
  );
}

/** Seconds since printing started (−1 while models are still loading). */
const clock = { elapsed: -1 };

/** How far one spot has printed, 0 → 1, at a steady layer speed. */
function progressOf(phase: { start: number; seconds: number }): number {
  return Math.min(
    1,
    Math.max(0, (clock.elapsed - phase.start) / phase.seconds),
  );
}

function PrintClock({ onDone }: { onDone: () => void }) {
  const started = useRef<number | null>(null);
  useEffect(() => {
    clock.elapsed = 0;
    return () => {
      clock.elapsed = -1;
    };
  }, []);
  useFrame(({ clock: frame }) => {
    started.current ??= frame.elapsedTime;
    clock.elapsed = frame.elapsedTime - started.current;
    if (clock.elapsed >= PRINT_END) onDone();
  });
  return null;
}

function Studio() {
  const { gl, scene } = useThree();
  useEffect(() => {
    scene.environment = studioEnvironment(gl);
    scene.environmentIntensity = 0.55;
  }, [gl, scene]);
  return null;
}

/** Frames the whole bed whatever the canvas shape, and lets the visitor turn it. */
function Rig() {
  const { camera, gl, size, invalidate } = useThree();
  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const vertical = (camera.fov * Math.PI) / 180;
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
    const half = Math.min(vertical, horizontal) / 2;
    // Seen at an angle the bed is wider than it is deep: narrow (phone) canvases need more room.
    const fit = camera.aspect < 1.2 ? 0.8 : 0.6;
    const distance = (PLATE * fit) / Math.tan(half);
    camera.position.set(0.35, 0.72, 1).normalize().multiplyScalar(distance);
    camera.lookAt(0, 18, 0);
    camera.updateProjectionMatrix();

    const controls = new OrbitControls(camera, gl.domElement);
    controls.target.set(0, 18, 0);
    controls.enableZoom = false; // the page scrolls; the bed doesn't zoom
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.minPolarAngle = 0.35;
    controls.maxPolarAngle = 1.25;
    controls.addEventListener('change', () => invalidate());
    // Vertical swipes scroll the page on phones; sideways drags turn the bed.
    gl.domElement.style.touchAction = 'pan-y';
    let frame = 0;
    const tick = () => {
      // Damping keeps easing after a drag ends; update returns true while it does.
      if (controls.update()) invalidate();
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      controls.dispose();
    };
  }, [camera, gl, size, invalidate]);
  return null;
}

/** The plate itself: a slab in the logo's plate colour with a fine grid. */
function Bed() {
  const { plate, grid } = useSceneColors();
  return (
    <group>
      <mesh position={[0, -3, 0]}>
        <boxGeometry args={[PLATE, 6, PLATE]} />
        <meshStandardMaterial color={plate} roughness={0.8} />
      </mesh>
      <gridHelper
        args={[PLATE, 16, grid, grid]}
        position={[0, 0.05, 0]}
        material-transparent
        material-opacity={0.22}
      />
    </group>
  );
}

interface Placed {
  model: Object3D;
  height: number;
  /** Footprint half-sizes, for the nozzle outline. */
  halfX: number;
  halfZ: number;
  plane: Plane;
}

/** One product on the bed: grows from the plate while printing, then can be hovered and opened. */
function PrintedModel({
  item,
  at,
  slot,
  phase,
  printing,
  lifted,
  onReady,
  onHover,
  onOpen,
}: {
  item: PlateItem;
  at: readonly [number, number];
  slot: number;
  phase: { start: number; seconds: number };
  printing: boolean;
  lifted: boolean;
  onReady: () => void;
  onHover: (slug: string | null) => void;
  onOpen: (slug: string) => void;
}) {
  const [placed, setPlaced] = useState<Placed | null>(null);
  const { accent } = useSceneColors();
  const group = useRef<Group>(null);
  const outline = useRef<LineLoop>(null);
  const { invalidate } = useThree();

  useEffect(() => {
    let cancelled = false;
    loadModel(item.modelKey, 'lite')
      .then((model) => {
        if (cancelled) return;
        paint(model, item.color);
        const box = new Box3().setFromObject(model);
        const size = box.getSize(new Vector3());
        const scale = Math.min(1, slot / Math.max(size.x, size.z));
        model.scale.multiplyScalar(scale);
        const center = box.getCenter(new Vector3());
        // Footprint centred on the spot, bottom on the plate.
        model.position.set(
          -center.x * scale,
          -box.min.y * scale,
          -center.z * scale,
        );
        // Everything above the plane is cut away: a clipping plane at the current layer.
        const plane = new Plane(new Vector3(0, -1, 0), 0);
        model.traverse((child) => {
          if (!(child instanceof Mesh)) return;
          const materials = (
            Array.isArray(child.material) ? child.material : [child.material]
          ).map((m: Material) => {
            const copy = m.clone();
            copy.clippingPlanes = [plane];
            // The inside shows while it is cut, as it would on the printer.
            copy.side = DoubleSide;
            return copy;
          });
          child.material = materials.length === 1 ? materials[0]! : materials;
        });
        setPlaced({
          model,
          height: size.y * scale,
          halfX: (size.x * scale) / 2,
          halfZ: (size.z * scale) / 2,
          plane,
        });
        invalidate();
      })
      // A model that fails to load just leaves its spot on the bed empty.
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) onReady();
      });
    return () => {
      cancelled = true;
    };
  }, [item.modelKey, item.color, slot, invalidate, onReady]);

  const outlineGeometry = useMemo(() => {
    const g = new BufferGeometry();
    if (placed) {
      const x = placed.halfX + 2;
      const z = placed.halfZ + 2;
      g.setAttribute(
        'position',
        new Float32BufferAttribute([-x, 0, -z, x, 0, -z, x, 0, z, -x, 0, z], 3),
      );
    }
    return g;
  }, [placed]);
  useEffect(() => () => outlineGeometry.dispose(), [outlineGeometry]);

  useFrame(() => {
    if (!placed || !group.current) return;
    const progress = printing ? progressOf(phase) : 1;
    const layer = placed.height * progress;
    // The plane is in world space: follow the model's lift when hovered. Nothing shows until
    // its turn (layer 0 cuts everything away).
    placed.plane.constant =
      progress === 0 ? -1 : layer + group.current.position.y + 0.01;
    if (outline.current) {
      outline.current.position.y = layer;
      outline.current.visible = printing && progress > 0 && progress < 1;
      (outline.current.material as LineBasicMaterial).color.set(accent);
    }
  });

  useEffect(() => {
    if (!group.current) return;
    group.current.position.y = lifted ? 4 : 0;
    invalidate();
  }, [lifted, invalidate]);

  if (!placed) return null;
  return (
    <group position={[at[0], 0, at[1]]}>
      <group
        ref={group}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
          onHover(item.slug);
        }}
        onPointerOut={() => {
          document.body.style.cursor = '';
          onHover(null);
        }}
        onClick={(e) => {
          e.stopPropagation();
          onOpen(item.slug);
        }}
      >
        <primitive object={placed.model} />
      </group>
      <lineLoop ref={outline} geometry={outlineGeometry}>
        <lineBasicMaterial color={accent} />
      </lineLoop>
    </group>
  );
}
