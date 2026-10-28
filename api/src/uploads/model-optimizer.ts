import { Document, NodeIO } from '@gltf-transform/core';
import {
  EXTMeshoptCompression,
  KHRMeshQuantization,
} from '@gltf-transform/extensions';
import { stlPositions } from '@forgea/pricing';
import type { ModelVariant } from '@forgea/validation';
import { Injectable } from '@nestjs/common';
import {
  MeshoptDecoder,
  MeshoptEncoder,
  MeshoptSimplifier,
} from 'meshoptimizer';

/** Triangles kept in the `lite` copy: plenty for a shop card or the home page bed. */
export const LITE_TRIANGLES = 30_000;
/** How far `lite` may drift from the original, as a share of the model's size. */
const LITE_MAX_ERROR = 0.005;

/**
 * Makes the compressed copies of an uploaded model that browsers download (the upload itself
 * stays untouched, for printing). Output is GLB with meshopt compression, which three.js
 * decodes with the decoder it ships, so no extra download.
 *
 * STL (millimetres, Z-up, one flat triangle list) becomes an indexed, welded mesh in metres,
 * Y-up, positions stored as 16-bit numbers (0.0015% of the model's size: far finer than any
 * printer), no normals (flat-shaded, as STL facets are). GLB files are re-encoded as they
 * are; both copies are the same. Pure WebAssembly: no native modules.
 */
@Injectable()
export class ModelOptimizer {
  private io: Promise<NodeIO> | null = null;

  async variants(
    data: Uint8Array,
    extension: string,
  ): Promise<Record<ModelVariant, Uint8Array>> {
    const io = await this.nodeIo();
    if (extension === 'stl') {
      const mesh = weldedStl(data);
      return {
        view: await io.writeBinary(meshDocument(mesh)),
        lite: await io.writeBinary(meshDocument(simplified(mesh))),
      };
    }
    if (extension === 'glb') {
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

  private nodeIo(): Promise<NodeIO> {
    this.io ??= Promise.all([
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
    return this.io;
  }
}

interface IndexedMesh {
  /** x, y, z per vertex, metres, Y-up. */
  positions: Float32Array;
  indices: Uint32Array;
}

/** STL triangles as an indexed mesh: identical corners merged into one vertex. */
function weldedStl(data: Uint8Array): IndexedMesh {
  const raw = stlPositions(data);
  const positions = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i += 3) {
    // Z-up millimetres → Y-up metres (a quarter turn about X, as the viewer does).
    positions[i] = raw[i]! / 1000;
    positions[i + 1] = raw[i + 2]! / 1000;
    positions[i + 2] = -raw[i + 1]! / 1000;
  }
  // Each corner points at the first vertex with the same position; the unused copies are
  // dropped by `compact`.
  const indices = MeshoptSimplifier.generatePositionRemap(positions, 3);
  return compact({ positions, indices });
}

/** Fewer triangles, same outline. A model already small enough is left as it is. */
function simplified(mesh: IndexedMesh): IndexedMesh {
  if (mesh.indices.length / 3 <= LITE_TRIANGLES) return mesh;
  const [indices] = MeshoptSimplifier.simplify(
    mesh.indices,
    mesh.positions,
    3,
    LITE_TRIANGLES * 3,
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

/** One mesh, positions as 16-bit fractions of its bounding box (the node scales them back). */
function meshDocument({ positions, indices }: IndexedMesh): Document {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const axis = i % 3;
    min[axis] = Math.min(min[axis]!, positions[i]!);
    max[axis] = Math.max(max[axis]!, positions[i]!);
  }
  const extent = max.map((m, axis) => Math.max(m - min[axis]!, 1e-9));
  const quantized = new Uint16Array(positions.length);
  for (let i = 0; i < positions.length; i++) {
    const axis = i % 3;
    quantized[i] = Math.round(
      ((positions[i]! - min[axis]!) / extent[axis]!) * 65535,
    );
  }

  const document = new Document();
  const buffer = document.createBuffer();
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
  const node = document
    .createNode('model')
    .setMesh(document.createMesh('model').addPrimitive(primitive))
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
