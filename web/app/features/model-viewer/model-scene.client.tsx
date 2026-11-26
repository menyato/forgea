import { renderer } from './three-console.client';
import { meshVolume } from '@forgea/pricing';
import {
  Canvas,
  type ThreeEvent,
  useLoader,
  useThree,
} from '@react-three/fiber';
import {
  type MutableRefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Box3,
  BufferGeometry,
  Color,
  FrontSide,
  Mesh,
  type Object3D,
  PerspectiveCamera,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import {
  gltfLoader,
  markPaintable,
  paint,
  recolourable,
  recolourParts,
  studioEnvironment,
  uprightStl,
} from './model-assets.client';
import type { ModelExtra, ModelMeasurement, ModelPick } from './model-viewer';
import { useSceneColors } from './theme-colors';

export interface SceneProps {
  src: string;
  format: 'stl' | 'glb';
  /** A GLB made from an STL: it takes `color` too. */
  paintable: boolean;
  /** Colour for STL models (they carry none); GLB models keep their own materials. */
  color: string;
  /**
   * A multi-colour (3MF) copy: its parts' file colours (#rrggbb, the materials' names) shown in
   * the colours the customer chose instead.
   */
  recolour?: Readonly<Record<string, string>> | undefined;
  /** Slow turntable; off when the visitor prefers reduced motion. */
  spin: boolean;
  onMeasured?: ((m: ModelMeasurement) => void) | undefined;
  extras?: readonly ModelExtra[] | undefined;
  onPick?: ((pick: ModelPick) => void) | undefined;
  /** Pressing on the model and dragging: the spot under the pointer as it moves, then where it was let go. */
  onDrag?: ((pick: ModelPick, done: boolean) => void) | undefined;
}

/** The WebGL scene. Imported lazily, in the browser only: three.js never runs on the server. */
export default function ModelScene(props: SceneProps) {
  return (
    <Canvas
      camera={{ fov: 35, near: 0.1, far: 10_000 }}
      dpr={[1, 2]}
      gl={renderer({ antialias: true, preserveDrawingBuffer: false })}
      // Rendered only when something changes, except while it spins: kind to phone batteries.
      frameloop={props.spin ? 'always' : 'demand'}
    >
      <StudioLight />
      <directionalLight position={[2, 4, 3]} intensity={1.4} />
      {/* A rim light from behind, so dark filament keeps its outline. */}
      <directionalLight position={[-3, 2, -4]} intensity={0.9} />
      {props.format === 'stl' ? <Stl {...props} /> : <Glb {...props} />}
    </Canvas>
  );
}

function Stl({
  src,
  color,
  spin,
  onMeasured,
  extras,
  onPick,
  onDrag,
}: SceneProps) {
  const controls = useRef<OrbitControls | null>(null);
  const drag = useDrag(onDrag, 1, controls);
  const loaded = useLoader(STLLoader, src);
  const { geometry, mesh } = useMemo(() => {
    const g = uprightStl(loaded);
    // Measured and framed without a material; the JSX mesh below is what renders.
    return { geometry: g, mesh: new Mesh(g) };
  }, [loaded]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => {
    onMeasured?.(measure(mesh, 1));
  }, [mesh, onMeasured]);
  return (
    <Framed object={mesh} spin={spin} controlsRef={controls}>
      <mesh geometry={geometry} onClick={picker(onPick, 1)} {...drag}>
        <meshStandardMaterial
          color={new Color(color)}
          roughness={0.5}
          metalness={0.05}
        />
      </mesh>
      <Extras extras={extras} scale={1} />
    </Framed>
  );
}

/**
 * Whether the model's shaders are ready: compiled in the background (`compileAsync`) before it
 * joins the scene, so its first frame never stops the page while the GPU compiles them (a
 * second or more for a big assembled piece). Where that can't be done, at once.
 */
function useCompiled(model: Object3D): boolean {
  const { gl, camera, scene, invalidate } = useThree();
  const [ready, setReady] = useState<Object3D | null>(null);
  useEffect(() => {
    let off = false;
    gl.compileAsync(model, camera, scene)
      .catch(() => undefined)
      .finally(() => {
        if (off) return;
        setReady(model);
        invalidate();
      });
    return () => {
      off = true;
    };
  }, [gl, camera, scene, model, invalidate]);
  return ready === model;
}

function Glb({
  src,
  paintable,
  color,
  recolour,
  spin,
  onMeasured,
  extras,
  onPick,
  onDrag,
}: SceneProps) {
  const gltf = useLoader(GLTFLoader, src, (loader) => gltfLoader(loader));
  const controls = useRef<OrbitControls | null>(null);
  const drag = useDrag(onDrag, 1000, controls);
  // A copy made from an STL takes the chosen colour, like the STL itself.
  const parts = !paintable && recolour !== undefined;
  const model = useMemo(() => {
    if (parts) return recolourable(gltf.scene);
    // Its own copy (meshes shared): the loader caches one scene per file, and an object lives
    // in one scene only. Two viewers of one model (a product's preview and its text editor)
    // would otherwise share it, the second framing it with the first one's offset.
    // A 3MF printed in one colour takes the colour chosen in the shop, as an STL does; one
    // in several colours keeps its own (its parts are recoloured one by one, above).
    if (!paintable && !(color && oneColour(gltf.scene)))
      return gltf.scene.clone();
    const painted = markPaintable(gltf.scene.clone());
    paint(painted, color);
    return painted;
  }, [gltf, paintable, color, parts]);
  // A 3MF's parts in the customer's colours: the same meshes, their own materials recoloured.
  const { invalidate } = useThree();
  useEffect(() => {
    if (!parts || !recolour) return;
    recolourParts(model, recolour);
    invalidate();
  }, [model, parts, recolour, invalidate]);
  useEffect(() => {
    // glTF is in metres; printing (and the estimate) works in millimetres.
    onMeasured?.(measure(model, 1000));
  }, [model, onMeasured]);
  const compiled = useCompiled(model);
  return (
    <Framed object={model} spin={spin} controlsRef={controls}>
      {compiled && (
        <primitive object={model} onClick={picker(onPick, 1000)} {...drag} />
      )}
      {/* glTF is in metres: the extras, in millimetres, shrink to match. */}
      <Extras extras={extras} scale={0.001} />
    </Framed>
  );
}

/**
 * Text and logos on the model: given in the model file's frame (millimetres, Z up) and turned
 * upright as the model itself is (Y up), scaled to the scene's units.
 */
function Extras({
  extras,
  scale,
}: {
  extras: readonly ModelExtra[] | undefined;
  scale: number;
}) {
  const { invalidate } = useThree();
  useEffect(() => invalidate(), [extras, invalidate]);
  if (!extras?.length) return null;
  return (
    <group rotation={[-Math.PI / 2, 0, 0]} scale={scale}>
      {extras.map((e, i) => (
        <mesh key={i} geometry={e.geometry}>
          <meshStandardMaterial
            color={new Color(e.color)}
            roughness={0.5}
            metalness={0.05}
          />
        </mesh>
      ))}
    </group>
  );
}

/**
 * A click on the model, as the dashboard places text: the spot and the face's outward
 * direction, back in the model file's frame (millimetres, Z up). `toMm`: the scene's units.
 */
function picker(onPick: ((pick: ModelPick) => void) | undefined, toMm: number) {
  if (!onPick) return undefined;
  return (e: ThreeEvent<MouseEvent>) => {
    // A drag to turn the model is not a click on it.
    if (e.delta > 4) return;
    const pick = pickOf(e, toMm);
    if (!pick) return;
    e.stopPropagation();
    onPick(pick);
  };
}

/** The spot under the pointer and the face's outward direction, in the model file's frame. */
function pickOf(
  e: ThreeEvent<MouseEvent> | ThreeEvent<PointerEvent>,
  toMm: number,
): ModelPick | null {
  if (!e.face) return null;
  const root = e.eventObject;
  const local = root.worldToLocal(e.point.clone());
  const normal = e.face.normal
    .clone()
    .transformDirection(e.object.matrixWorld)
    .transformDirection(root.matrixWorld.clone().invert())
    .normalize();
  // Y up (the scene) back to Z up (the file): x, y, z = x, -z, y.
  return {
    origin: [local.x * toMm, -local.z * toMm, local.y * toMm],
    normal: [normal.x, -normal.z, normal.y],
    triangles: () => fileTriangles(root, toMm),
  };
}

/**
 * Drag and drop on the model: pressing on it stops the turntable controls (the model holds
 * still), each move reports the spot under the pointer, letting go anywhere reports the last.
 */
function useDrag(
  onDrag: SceneProps['onDrag'],
  toMm: number,
  controls: MutableRefObject<OrbitControls | null>,
) {
  const last = useRef<ModelPick | null>(null);
  const active = useRef(false);
  useEffect(() => {
    if (!onDrag) return;
    const up = () => {
      if (!active.current) return;
      active.current = false;
      if (controls.current) controls.current.enabled = true;
      if (last.current) onDrag(last.current, true);
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [onDrag, controls]);
  if (!onDrag) return {};
  return {
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      const pick = pickOf(e, toMm);
      if (!pick) return;
      e.stopPropagation();
      active.current = true;
      if (controls.current) controls.current.enabled = false;
      last.current = pick;
      onDrag(pick, false);
    },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      if (!active.current) return;
      const pick = pickOf(e, toMm);
      if (!pick) return;
      e.stopPropagation();
      last.current = pick;
      onDrag(pick, false);
    },
  };
}

/** Whether every mesh of a model is drawn in one colour (a one-colour print). */
function oneColour(model: Object3D): boolean {
  const colours = new Set<string>();
  model.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material])
      if (m && 'color' in m && m.color instanceof Color)
        colours.add(m.color.getHexString());
  });
  return colours.size === 1;
}

/** Every mesh's triangles under `root`, in the file's millimetres (Z up). */
function fileTriangles(root: Object3D, toMm: number): Float32Array {
  root.updateWorldMatrix(true, true);
  const toRoot = root.matrixWorld.clone().invert();
  const out: number[] = [];
  const p = new Vector3();
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const g: BufferGeometry = o.geometry;
    const pos = g.getAttribute('position');
    if (!pos) return;
    const m = toRoot.clone().multiply(o.matrixWorld);
    const index = g.getIndex();
    const count = index ? index.count : pos.count;
    for (let i = 0; i < count; i++) {
      p.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(m);
      // Y up (the scene) back to Z up (the file), as the pick itself.
      out.push(p.x * toMm, -p.z * toMm, p.y * toMm);
    }
  });
  return new Float32Array(out);
}

/** Reflections from a generated studio, so materials read as plastic. */
export function StudioLight() {
  const { gl, scene, invalidate } = useThree();
  useEffect(() => {
    scene.environment = studioEnvironment(gl);
    scene.environmentIntensity = 0.6;
    invalidate();
  }, [gl, scene, invalidate]);
  return null;
}

/** The print plate the model stands on, in the theme's plate colour. */
export function Plate({ radius, y }: { radius: number; y: number }) {
  const { plate } = useSceneColors();
  // Only its top face, drawn from above: turned to look under the model, the plate is not
  // there, so the underside's details show.
  return (
    <mesh position={[0, y - radius * 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[radius, 64]} />
      <meshStandardMaterial color={plate} roughness={0.85} side={FrontSide} />
    </mesh>
  );
}

/** Centres the model on the turntable and moves the camera back until all of it fits. */
function Framed({
  object,
  spin,
  controlsRef,
  children,
}: {
  object: Object3D;
  spin: boolean;
  /** Where the turntable controls are kept, so a drag on the model can hold them still. */
  controlsRef?: MutableRefObject<OrbitControls | null>;
  children: React.ReactNode;
}) {
  const { camera, gl, invalidate } = useThree();
  const { center, radius, bottom } = useMemo(() => {
    const box = new Box3().setFromObject(object);
    const center = box.getCenter(new Vector3());
    return {
      center,
      radius: Math.max(box.getSize(new Vector3()).length() / 2, 1e-3),
      bottom: box.min.y - center.y,
    };
  }, [object]);

  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const distance = radius / Math.sin((camera.fov * Math.PI) / 360);
    camera.position.set(distance * 0.75, distance * 0.55, distance * 0.9);
    camera.near = distance / 100;
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enableDamping = true;
    controls.autoRotate = spin;
    controls.autoRotateSpeed = 1.2;
    controls.minDistance = radius * 1.2;
    controls.maxDistance = distance * 4;
    controls.addEventListener('change', () => invalidate());
    if (controlsRef) controlsRef.current = controls;
    // OrbitControls claims every touch; give vertical swipes back to the page so phones can
    // scroll past the viewer. Sideways drags still turn the model, two fingers still zoom.
    gl.domElement.style.touchAction = 'pan-y';
    let frame = 0;
    const tick = () => {
      controls.update();
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      controls.dispose();
      if (controlsRef) controlsRef.current = null;
    };
  }, [camera, gl, invalidate, radius, spin, controlsRef]);

  return (
    <>
      <Plate radius={radius * 0.95} y={bottom} />
      <group position={[-center.x, -center.y, -center.z]}>{children}</group>
    </>
  );
}

/** Size and volume in millimetres, for the dashboard's grams and hours suggestion. */
function measure(object: Object3D, toMm: number): ModelMeasurement {
  object.updateMatrixWorld(true);
  let volume = 0;
  object.traverse((child) => {
    if (!(child instanceof Mesh) || !(child.geometry instanceof BufferGeometry))
      return;
    const flat = child.geometry.index
      ? child.geometry.toNonIndexed()
      : child.geometry.clone();
    flat.applyMatrix4(child.matrixWorld);
    volume += meshVolume(flat.getAttribute('position').array);
    flat.dispose();
  });
  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  // The scene is Y up; the file is Z up (x, y, z = x, -z, y).
  return {
    volumeMm3: volume * toMm ** 3,
    sizeMm: [size.x * toMm, size.y * toMm, size.z * toMm],
    box: {
      min: [box.min.x * toMm, -box.max.z * toMm, box.min.y * toMm],
      max: [box.max.x * toMm, -box.min.z * toMm, box.max.y * toMm],
    },
  };
}
