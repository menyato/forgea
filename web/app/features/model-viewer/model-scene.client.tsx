import './three-console.client';
import { meshVolume } from '@forgea/pricing';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  Box3,
  BufferGeometry,
  Color,
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
  studioEnvironment,
  uprightStl,
} from './model-assets.client';
import type { ModelMeasurement } from './model-viewer';
import { useSceneColors } from './theme-colors';

export interface SceneProps {
  src: string;
  format: 'stl' | 'glb';
  /** A GLB made from an STL: it takes `color` too. */
  paintable: boolean;
  /** Colour for STL models (they carry none); GLB models keep their own materials. */
  color: string;
  /** Slow turntable; off when the visitor prefers reduced motion. */
  spin: boolean;
  onMeasured?: ((m: ModelMeasurement) => void) | undefined;
}

/** The WebGL scene. Imported lazily, in the browser only: three.js never runs on the server. */
export default function ModelScene(props: SceneProps) {
  return (
    <Canvas
      camera={{ fov: 35, near: 0.1, far: 10_000 }}
      dpr={[1, 2]}
      gl={{ antialias: true, preserveDrawingBuffer: false }}
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

function Stl({ src, color, spin, onMeasured }: SceneProps) {
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
    <Framed object={mesh} spin={spin}>
      <mesh geometry={geometry}>
        <meshStandardMaterial
          color={new Color(color)}
          roughness={0.5}
          metalness={0.05}
        />
      </mesh>
    </Framed>
  );
}

function Glb({ src, paintable, color, spin, onMeasured }: SceneProps) {
  const gltf = useLoader(GLTFLoader, src, (loader) => gltfLoader(loader));
  // A copy made from an STL takes the chosen colour, like the STL itself.
  const model = useMemo(() => {
    if (!paintable) return gltf.scene;
    const painted = markPaintable(gltf.scene.clone());
    paint(painted, color);
    return painted;
  }, [gltf, paintable, color]);
  useEffect(() => {
    // glTF is in metres; printing (and the estimate) works in millimetres.
    onMeasured?.(measure(model, 1000));
  }, [model, onMeasured]);
  return (
    <Framed object={model} spin={spin}>
      <primitive object={model} />
    </Framed>
  );
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
  return (
    <mesh position={[0, y - radius * 0.02, 0]}>
      <cylinderGeometry args={[radius, radius, radius * 0.04, 64]} />
      <meshStandardMaterial color={plate} roughness={0.85} />
    </mesh>
  );
}

/** Centres the model on the turntable and moves the camera back until all of it fits. */
function Framed({
  object,
  spin,
  children,
}: {
  object: Object3D;
  spin: boolean;
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
    };
  }, [camera, gl, invalidate, radius, spin]);

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
  const size = new Box3().setFromObject(object).getSize(new Vector3());
  return {
    volumeMm3: volume * toMm ** 3,
    sizeMm: [size.x * toMm, size.y * toMm, size.z * toMm],
  };
}
