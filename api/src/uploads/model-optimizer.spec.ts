import { NodeIO } from '@gltf-transform/core';
import {
  EXTMeshoptCompression,
  KHRMeshQuantization,
} from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { cube } from '../../prisma/example-models.js';
import { ModelOptimizer } from './model-optimizer.js';
import { glbProblem } from './glb-check.js';
import { LITE_TRIANGLES } from './model-processing.js';

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

/** A GLB with this JSON chunk and a small binary chunk. */
function glb(json: object): Uint8Array {
  const text = new TextEncoder().encode(
    JSON.stringify(json).padEnd(Math.ceil(JSON.stringify(json).length / 4) * 4),
  );
  const bin = new Uint8Array(4);
  const out = new Uint8Array(12 + 8 + text.length + 8 + bin.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, text.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  view.setUint32(20 + text.length, bin.length, true);
  view.setUint32(24 + text.length, 0x004e4942, true);
  return out;
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

/** A loader for bytes already in memory. */
const load = (data: Uint8Array) => () => Promise.resolve(data);

describe('ModelOptimizer', () => {
  const optimizer = new ModelOptimizer();

  it('turns an STL into a welded, compressed GLB in metres, standing up', async () => {
    const stl = cube(30);
    const { view, lite } = await optimizer.variants(load(stl), 'stl');
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
    const { view, lite } = await optimizer.variants(load(stl), 'stl');
    const [full, light] = [await read(view), await read(lite)];
    expect(full.triangles).toBeGreaterThan(240_000);
    expect(light.triangles).toBeLessThanOrEqual(LITE_TRIANGLES);
    light.size.forEach((s, axis) => expect(s).toBeCloseTo(full.size[axis]!, 2));
    // Both copies together stay far smaller than the STL.
    expect(view.byteLength + lite.byteLength).toBeLessThan(stl.byteLength / 4);
  });

  it('re-encodes an uploaded GLB as it is, one copy for both uses', async () => {
    const { view: glb } = await optimizer.variants(load(cube(30)), 'stl');
    const { view, lite } = await optimizer.variants(load(glb), 'glb');
    expect(lite).toBe(view);
    const model = await read(view);
    expect(model.triangles).toBe(12);
    expect(model.extensions).toContain('EXT_meshopt_compression');
  });

  it('refuses at once an STL whose triangles all collapse onto one point', async () => {
    // 80 000 such triangles (4 MB) used to stall the API for 40 seconds.
    const flat = new Uint8Array(84 + 80_000 * 50);
    new DataView(flat.buffer).setUint32(80, 80_000, true);
    const started = Date.now();
    await expect(optimizer.variants(load(flat), 'stl')).rejects.toThrow(
      /no surface/,
    );
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('refuses a tiny GLB that claims gigabytes of compressed geometry', async () => {
    const hostile = glb({
      asset: { version: '2.0' },
      buffers: [{ byteLength: 4 }],
      bufferViews: [
        {
          buffer: 0,
          byteLength: 4,
          extensions: {
            EXT_meshopt_compression: {
              buffer: 0,
              byteLength: 4,
              count: 100_000_000,
              byteStride: 16,
              mode: 'ATTRIBUTES',
            },
          },
        },
      ],
      extensionsUsed: ['EXT_meshopt_compression'],
    });
    expect(glbProblem(hostile)).toMatch(/declares more data/);
    await expect(optimizer.variants(load(hostile), 'glb')).rejects.toThrow(
      /declares more data/,
    );
  });

  it('refuses a GLB that points to other files or sites', () => {
    const linked = glb({
      asset: { version: '2.0' },
      images: [{ uri: 'https://attacker.example/pixel.png' }],
    });
    expect(glbProblem(linked)).toMatch(/no links/);
    expect(glbProblem(new Uint8Array([1, 2, 3]))).toMatch(/damaged/);
  });

  it('gives up on a model that takes too long, without blocking the API', async () => {
    const slow = new ModelOptimizer();
    slow.timeLimitMs = 1;
    await expect(slow.variants(load(cube(30)), 'stl')).rejects.toThrow(
      /took too long/,
    );
  });

  it('refuses a file that is not a model', async () => {
    await expect(
      optimizer.variants(load(new Uint8Array([1, 2, 3])), 'png'),
    ).rejects.toThrow(/Not a 3D model/);
  });
});
