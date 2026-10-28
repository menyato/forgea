import { NodeIO } from '@gltf-transform/core';
import {
  EXTMeshoptCompression,
  KHRMeshQuantization,
} from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { cube } from '../../prisma/example-models.js';
import { LITE_TRIANGLES, ModelOptimizer } from './model-optimizer.js';

/** A binary STL sphere (millimetres) with `bands × 2·bands × 2` triangles. */
function sphereStl(radius: number, bands: number): Uint8Array {
  const point = (i: number, j: number): number[] => {
    const theta = (i / bands) * Math.PI;
    const phi = (j / (bands * 2)) * Math.PI * 2;
    return [
      radius * Math.sin(theta) * Math.cos(phi),
      radius * Math.sin(theta) * Math.sin(phi),
      radius * Math.cos(theta),
    ];
  };
  const triangles: number[][] = [];
  for (let i = 0; i < bands; i++) {
    for (let j = 0; j < bands * 2; j++) {
      const [a, b, c, d] = [
        point(i, j),
        point(i + 1, j),
        point(i + 1, j + 1),
        point(i, j + 1),
      ];
      triangles.push([...a!, ...b!, ...c!], [...a!, ...c!, ...d!]);
    }
  }
  const out = new DataView(new ArrayBuffer(84 + triangles.length * 50));
  out.setUint32(80, triangles.length, true);
  triangles.forEach((t, n) =>
    t.forEach((v, k) => out.setFloat32(84 + n * 50 + 12 + k * 4, v, true)),
  );
  return new Uint8Array(out.buffer);
}

async function read(glb: Uint8Array) {
  await MeshoptDecoder.ready;
  const document = await new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
    .readBinary(glb);
  const root = document.getRoot();
  const node = root.listNodes()[0]!;
  const primitive = node.getMesh()!.listPrimitives()[0]!;
  const position = primitive.getAttribute('POSITION')!;
  // Back to metres: the node's scale and translation undo the 16-bit quantization.
  const [scale, offset] = [node.getScale(), node.getTranslation()];
  const max = position
    .getMax([])
    .map((m, axis) => (m / 65535) * scale[axis]! + offset[axis]!);
  const min = position
    .getMin([])
    .map((m, axis) => (m / 65535) * scale[axis]! + offset[axis]!);
  return {
    extensions: root.listExtensionsUsed().map((e) => e.extensionName),
    vertices: position.getCount(),
    triangles: primitive.getIndices()!.getCount() / 3,
    size: max.map((m, axis) => m - min[axis]!),
    min,
  };
}

describe('ModelOptimizer', () => {
  const optimizer = new ModelOptimizer();

  it('turns an STL into a welded, compressed GLB in metres, standing up', async () => {
    const stl = cube(30);
    const { view, lite } = await optimizer.variants(stl, 'stl');
    const model = await read(view);
    expect(model.extensions.sort()).toEqual([
      'EXT_meshopt_compression',
      'KHR_mesh_quantization',
    ]);
    // 12 triangles of 3 corners each in the STL; a cube has 8 corners.
    expect(model.vertices).toBe(8);
    expect(model.triangles).toBe(12);
    model.size.forEach((s) => expect(s).toBeCloseTo(0.03, 5));
    // Z-up → Y-up: it stands on y = 0 and extends towards -z.
    expect(model.min[1]).toBeCloseTo(0, 5);
    expect(model.min[2]).toBeCloseTo(-0.03, 5);
    // Small models are not simplified.
    expect((await read(lite)).triangles).toBe(12);
  });

  it('simplifies a detailed model for the lite copy, keeping its size', async () => {
    const stl = sphereStl(40, 250); // 250 000 triangles, 12.5 MB
    const { view, lite } = await optimizer.variants(stl, 'stl');
    const [full, light] = [await read(view), await read(lite)];
    expect(full.triangles).toBeGreaterThan(240_000);
    expect(light.triangles).toBeLessThanOrEqual(LITE_TRIANGLES);
    light.size.forEach((s, axis) => expect(s).toBeCloseTo(full.size[axis]!, 2));
    // Both copies together stay far smaller than the STL.
    expect(view.byteLength + lite.byteLength).toBeLessThan(stl.byteLength / 4);
  });

  it('re-encodes an uploaded GLB as it is, one copy for both uses', async () => {
    const { view: glb } = await optimizer.variants(cube(30), 'stl');
    const { view, lite } = await optimizer.variants(glb, 'glb');
    expect(lite).toBe(view);
    const model = await read(view);
    expect(model.triangles).toBe(12);
    expect(model.extensions).toContain('EXT_meshopt_compression');
  });

  it('refuses a file that is not a model', async () => {
    await expect(
      optimizer.variants(new Uint8Array([1, 2, 3]), 'png'),
    ).rejects.toThrow(/Not a 3D model/);
  });
});
