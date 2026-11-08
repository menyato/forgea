import {
  type BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PMREMGenerator,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { ModelVariant } from '@forgea/validation/constants';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { modelSource } from './model-source';
import { takePrefetched } from './model-prefetch';

/**
 * Printing files are Z-up in millimetres; three.js is Y-up. Stands the model upright and fills
 * in normals some exporters leave empty. Works on a copy: loaded files are cached and shared.
 */
export function uprightStl(loaded: BufferGeometry): BufferGeometry {
  const g = loaded.clone().rotateX(-Math.PI / 2);
  const normals = g.getAttribute('normal');
  if (!normals || Array.from(normals.array).every((n) => n === 0)) {
    g.computeVertexNormals();
  }
  return g;
}

/**
 * How printed plastic looks: slightly glossy, never metallic (copper silk is a colour). Flat
 * shading shows the facets as an STL has them; the compressed copies carry no normals.
 */
const plasticMaterial = (color: string) =>
  new MeshStandardMaterial({
    color,
    roughness: 0.5,
    metalness: 0.05,
    flatShading: true,
  });

/** Reads GLB, including the API's compressed copies (meshopt; the decoder ships with three). */
export const gltfLoader = (loader: GLTFLoader = new GLTFLoader()) =>
  loader.setMeshoptDecoder(MeshoptDecoder);

/** Marks the meshes of a model that came from an STL, so `paint` recolours them. */
export function markPaintable(model: Object3D): Object3D {
  model.traverse((child) => {
    if (child instanceof Mesh) {
      child.userData['paintable'] = true;
      child.material = plasticMaterial('#888888');
    }
  });
  return model;
}

const loaded = new Map<string, Promise<Object3D>>();

/**
 * A model ready to place in a scene, in millimetres, Y-up. Each file is fetched once per page;
 * callers get their own clone. Pass a variant to load the API's compressed copy (the `lite`
 * one for small views); without one, the uploaded file itself.
 */
export async function loadModel(
  key: string,
  variant?: ModelVariant,
): Promise<Object3D> {
  const { src, format, paintable } = modelSource(key, variant);
  let pending = loaded.get(src);
  if (!pending) {
    // Downloaded early (the home page's bed) when three.js wasn't here yet: read those bytes;
    // if that download failed, fetch it now as usual.
    const early = takePrefetched(src);
    pending =
      format === 'stl'
        ? (early
            ? early
                .then((b) => new STLLoader().parse(b))
                .catch(() => new STLLoader().loadAsync(src))
            : new STLLoader().loadAsync(src)
          ).then((g) => markPaintable(new Mesh(uprightStl(g))))
        : (early
            ? early
                .then((b) => gltfLoader().parseAsync(b, ''))
                .catch(() => gltfLoader().loadAsync(src))
            : gltfLoader().loadAsync(src)
          ).then((gltf) => {
            // glTF is in metres.
            gltf.scene.scale.setScalar(1000);
            return paintable ? markPaintable(gltf.scene) : gltf.scene;
          });
    // A failed download may be retried by the next caller.
    pending.catch(() => loaded.delete(src));
    loaded.set(src, pending);
  }
  return (await pending).clone();
}

const FILE_COLOUR = /^#[0-9a-f]{6}$/;

/**
 * A copy of a multi-colour model whose parts can be recoloured: its own materials, so the
 * loaded file (shared by every view of it) keeps its colours.
 */
export function recolourable(model: Object3D): Object3D {
  const copy = model.clone();
  copy.traverse((child) => {
    if (child instanceof Mesh && child.material instanceof MeshStandardMaterial)
      child.material = child.material.clone();
  });
  return copy;
}

/**
 * Shows a 3MF copy's parts in other colours: each material is named after its file colour
 * (#rrggbb); one listed in `colours` takes the colour given for it, the others their file's.
 */
export function recolourParts(
  model: Object3D,
  colours: Readonly<Record<string, string>>,
): void {
  model.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const m: unknown = child.material;
    if (!(m instanceof MeshStandardMaterial)) return;
    const file = m.name.toLowerCase();
    if (FILE_COLOUR.test(file)) m.color.set(colours[file] ?? file);
  });
}

/** Gives models that came from an STL the chosen colour; GLB models keep their own. */
export function paint(model: Object3D, color: string): void {
  model.traverse((child) => {
    if (child instanceof Mesh && child.userData['paintable'] === true) {
      child.material = plasticMaterial(color);
    }
  });
}

const environments = new WeakMap<WebGLRenderer, Texture | null>();

/**
 * WebGL drawn by the CPU (no GPU, or one the browser blocks): SwiftShader, Mesa's llvmpipe,
 * Windows' Basic Render Driver. Browsers that hide the renderer's name count as GPU.
 */
function softwareRendered(renderer: WebGLRenderer): boolean {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = info
    ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
    : '';
  return /swiftshader|llvmpipe|softpipe|basic render driver/i.test(name);
}

/**
 * Soft studio reflections generated in the browser (no HDR file to download), so dark
 * filament reads as plastic instead of a black silhouette. Skipped where WebGL runs on the
 * CPU: generating them there takes seconds per scene (about 6 s on two cores), during which
 * the model stays hidden; the scene's own lights still show it.
 */
export function studioEnvironment(renderer: WebGLRenderer): Texture | null {
  if (environments.has(renderer)) return environments.get(renderer) ?? null;
  let texture: Texture | null = null;
  if (!softwareRendered(renderer)) {
    const pmrem = new PMREMGenerator(renderer);
    texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }
  environments.set(renderer, texture);
  return texture;
}
