import { Document, NodeIO } from '@gltf-transform/core';
import {
  EXTMeshoptCompression,
  KHRMeshQuantization,
} from '@gltf-transform/extensions';
import {
  meshVolume,
  PricingError,
  stlPositions,
  stlTriangleCount,
} from '@forgea/pricing';
import type { ModelVariant } from '@forgea/validation';
import {
  MeshoptDecoder,
  MeshoptEncoder,
  MeshoptSimplifier,
} from 'meshoptimizer';
import { glbProblem } from './glb-check.js';
import { readThreeMf, type ThreeMfInfo } from './three-mf.js';
import { stlFromPositions } from '@forgea/text3d';
import { printProject } from '../text-studio/print-project.js';

/** Triangles kept in the `lite` copy: plenty for a shop card or the home page bed. */
export const LITE_TRIANGLES = 30_000;
/** How far `lite` may drift from the original, as a share of the model's size. */
const LITE_MAX_ERROR = 0.005;
/** More than any printable model has (a 100 MB binary STL holds 2 million). */
const MAX_TRIANGLES = 3_000_000;

/**
 * The compressed copies of an uploaded model that browsers download (the upload itself stays
 * untouched, for printing). Output is GLB with meshopt compression, which three.js decodes
 * with the decoder it ships. Runs in a worker thread (model-worker.ts), never on the API's
 * main thread: see ModelOptimizer.
 *
 * STL (millimetres, Z-up, one flat triangle list) becomes an indexed, welded mesh in metres,
 * Y-up, positions stored as 16-bit numbers (0.0015% of the model's size: far finer than any
 * printer), no normals (flat-shaded, as STL facets are). GLB files are re-encoded as they are;
 * both copies are the same.
 */
export async function makeVariants(
  data: Uint8Array,
  extension: string,
): Promise<Record<ModelVariant, Uint8Array>> {
  const io = await nodeIo();
  if (extension === 'stl') {
    const mesh = weldedStl(data);
    return {
      view: await io.writeBinary(meshDocument([{ mesh, hex: null }])),
      lite: await io.writeBinary(
        meshDocument([{ mesh: simplified(mesh, LITE_TRIANGLES), hex: null }]),
      ),
    };
  }
  if (extension === '3mf') {
    // One mesh per filament, each in its colour; the lite copy shares its triangles out by size.
    const { parts } = readThreeMf(data);
    const meshes = parts.map((p) => ({
      mesh: welded(p.positions),
      hex: p.hex,
    }));
    const total = meshes.reduce((n, m) => n + m.mesh.indices.length / 3, 0);
    return {
      view: await io.writeBinary(meshDocument(meshes)),
      lite: await io.writeBinary(
        meshDocument(
          meshes.map(({ mesh, hex }) => ({
            mesh: simplified(
              mesh,
              Math.max(
                500,
                Math.floor((LITE_TRIANGLES * mesh.indices.length) / 3 / total),
              ),
            ),
            hex,
          })),
        ),
      ),
    };
  }
  if (extension === 'glb') {
    // Checked again here: files uploaded before the check existed.
    const problem = glbProblem(data);
    if (problem) throw new Error(problem);
    const document = await io.readBinary(data);
    document
      .createExtension(EXTMeshoptCompression)
      .setRequired(true)
      .setEncoderOptions({
        method: EXTMeshoptCompression.EncoderMethod.QUANTIZE,
      });
    const view = await io.writeBinary(document);
    return { view, lite: view };
  }
  throw new Error(`Not a 3D model: .${extension}`);
}

/**
 * A product's model with more parts placed on it (its text and logos), as one 3MF project for
 * the slicer: the model's own colours (an STL is one part), then the extra parts, all in the
 * model file's frame. Made here, in the worker: the model is the uploaded file.
 */
export function projectWith(
  data: Uint8Array,
  extension: string,
  title: string,
  extras: readonly { label: string; hex: string | null; stl: Uint8Array }[],
): Uint8Array {
  const model =
    extension === '3mf'
      ? readThreeMf(data).parts.map((p, i, all) => ({
          label: all.length > 1 ? `Model ${p.hex}` : 'Model',
          hex: p.hex,
          stl: stlFromPositions(p.positions, `part-${i + 1}`),
        }))
      : extension === 'stl'
        ? [{ label: 'Model', hex: null, stl: data }]
        : [];
  if (model.length === 0)
    throw new Error('Only an STL or 3MF model can take printed text');
  return printProject(title, [...model, ...extras]);
}

/** What a 3MF says about printing it (colours, volumes, the slicer's time and grams). */
export function threeMfInfo(data: Uint8Array): ThreeMfInfo {
  return readThreeMf(data).info;
}

/**
 * An STL's volume in mm³ for the instant estimate, or null when it can't be measured (not a
 * readable STL, or more than MAX_TRIANGLES): the studio then prices it by hand.
 */
export function measureVolume(data: Uint8Array): number | null {
  try {
    return stlTriangleCount(data) > MAX_TRIANGLES
      ? null
      : meshVolume(stlPositions(data));
  } catch (error) {
    if (error instanceof PricingError) return null;
    throw error;
  }
}

let io: Promise<NodeIO> | null = null;

function nodeIo(): Promise<NodeIO> {
  io ??= Promise.all([
    MeshoptEncoder.ready,
    MeshoptDecoder.ready,
    MeshoptSimplifier.ready,
  ]).then(() =>
    new NodeIO()
      .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
      .registerDependencies({
        'meshopt.encoder': MeshoptEncoder,
        'meshopt.decoder': MeshoptDecoder,
      }),
  );
  return io;
}

interface IndexedMesh {
  /** x, y, z per vertex, metres, Y-up. */
  positions: Float32Array;
  indices: Uint32Array;
}

/**
 * STL triangles as an indexed mesh: identical corners merged into one vertex, and triangles
 * with no area (two corners in the same place) dropped. Those draw nothing, and a file made
 * of them is what makes mesh optimisers slow down to a crawl.
 */
function weldedStl(data: Uint8Array): IndexedMesh {
  if (stlTriangleCount(data) > MAX_TRIANGLES) {
    throw new Error(`More than ${MAX_TRIANGLES} triangles`);
  }
  return welded(stlPositions(data));
}

/** Triangle corners (millimetres, Z-up) as an indexed mesh in metres, Y-up. */
function welded(raw: Float32Array): IndexedMesh {
  const positions = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i += 3) {
    // Z-up millimetres → Y-up metres (a quarter turn about X, as the viewer does).
    positions[i] = raw[i]! / 1000;
    positions[i + 1] = raw[i + 2]! / 1000;
    positions[i + 2] = -raw[i + 1]! / 1000;
  }
  // Each corner points at the first vertex with the same position; the unused copies are
  // dropped by `compact`.
  const corners = MeshoptSimplifier.generatePositionRemap(positions, 3);
  const indices = new Uint32Array(corners.length);
  let kept = 0;
  for (let i = 0; i < corners.length; i += 3) {
    const [a, b, c] = [corners[i]!, corners[i + 1]!, corners[i + 2]!];
    if (a === b || b === c || a === c) continue;
    indices.set([a, b, c], kept);
    kept += 3;
  }
  if (kept === 0) throw new Error('The model has no surface');
  return compact({ positions, indices: indices.subarray(0, kept) });
}

/** Fewer triangles, same outline. A model already small enough is left as it is. */
function simplified(mesh: IndexedMesh, triangles: number): IndexedMesh {
  if (mesh.indices.length / 3 <= triangles) return mesh;
  const [indices] = MeshoptSimplifier.simplify(
    mesh.indices,
    mesh.positions,
    3,
    triangles * 3,
    LITE_MAX_ERROR,
  );
  return compact({ positions: mesh.positions, indices });
}

/** Keeps only the vertices in use, in the order that compresses and renders best. */
function compact(mesh: IndexedMesh): IndexedMesh {
  const indices = mesh.indices.slice();
  const [remap, unique] = MeshoptEncoder.reorderMesh(indices, true, true);
  const positions = new Float32Array(unique * 3);
  for (let i = 0; i < remap.length; i++) {
    const to = remap[i]!;
    if (to === 0xffffffff) continue;
    positions.set(mesh.positions.subarray(i * 3, i * 3 + 3), to * 3);
  }
  return { positions, indices };
}

/**
 * One node, positions as 16-bit fractions of the whole model's bounding box (the node scales
 * them back). A part with a colour (a 3MF's filament) gets a plastic material in it; one
 * without (an STL) has none, and the viewer paints it.
 */
function meshDocument(
  parts: readonly { mesh: IndexedMesh; hex: string | null }[],
): Document {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const { mesh } of parts) {
    const { positions } = mesh;
    for (let i = 0; i < positions.length; i++) {
      const axis = i % 3;
      min[axis] = Math.min(min[axis]!, positions[i]!);
      max[axis] = Math.max(max[axis]!, positions[i]!);
    }
  }
  const extent = max.map((m, axis) => Math.max(m - min[axis]!, 1e-9));

  const document = new Document();
  const buffer = document.createBuffer();
  const gltfMesh = document.createMesh('model');
  for (const { mesh, hex } of parts) {
    const { positions, indices } = mesh;
    const quantized = new Uint16Array(positions.length);
    for (let i = 0; i < positions.length; i++) {
      const axis = i % 3;
      quantized[i] = Math.round(
        ((positions[i]! - min[axis]!) / extent[axis]!) * 65535,
      );
    }
    const position = document
      .createAccessor()
      .setType('VEC3')
      .setArray(quantized)
      .setNormalized(true)
      .setBuffer(buffer);
    const index = document
      .createAccessor()
      .setType('SCALAR')
      .setArray(
        positions.length / 3 <= 65535
          ? Uint16Array.from(indices)
          : Uint32Array.from(indices),
      )
      .setBuffer(buffer);
    const primitive = document
      .createPrimitive()
      .setAttribute('POSITION', position)
      .setIndices(index);
    if (hex) {
      primitive.setMaterial(
        document
          .createMaterial(hex)
          .setBaseColorFactor([...linearRgb(hex), 1])
          .setRoughnessFactor(0.5)
          .setMetallicFactor(0.05),
      );
    }
    gltfMesh.addPrimitive(primitive);
  }
  const node = document
    .createNode('model')
    .setMesh(gltfMesh)
    .setTranslation(min as [number, number, number])
    .setScale(extent as [number, number, number]);
  document.createScene().addChild(node);
  document.createExtension(KHRMeshQuantization).setRequired(true);
  document
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({
      method: EXTMeshoptCompression.EncoderMethod.QUANTIZE,
    });
  return document;
}

/** #RRGGBB as glTF wants colours: linear, 0–1. */
function linearRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((at) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
}
