/**
 * A personalised product's sample as one GLB: each colour part (a binary STL from the worker)
 * its own mesh with its own material, so the shop shows the piece in its colours (GLB models
 * keep their materials; STL models take one). glTF is Y-up: a lying piece (keychain, single
 * letters) is turned flat, a standing one is already upright.
 */
export function sampleGlb(
  parts: readonly { bytes: Uint8Array; hex: string }[],
  lying: boolean,
): Uint8Array {
  const views: { offset: number; length: number }[] = [];
  const accessors: object[] = [];
  const meshes: object[] = [];
  const materials: object[] = [];
  const chunks: Float32Array[] = [];
  let offset = 0;

  for (const [i, part] of parts.entries()) {
    const stl = new DataView(
      part.bytes.buffer,
      part.bytes.byteOffset,
      part.bytes.byteLength,
    );
    const count = stl.getUint32(80, true);
    const positions = new Float32Array(count * 9);
    const normals = new Float32Array(count * 9);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const turned = (
      x: number,
      y: number,
      z: number,
    ): [number, number, number] => (lying ? [x, z, -y] : [x, y, z]);
    for (let t = 0; t < count; t++) {
      const at = 84 + t * 50;
      const read = (k: number) =>
        turned(
          stl.getFloat32(at + k * 12, true),
          stl.getFloat32(at + k * 12 + 4, true),
          stl.getFloat32(at + k * 12 + 8, true),
        );
      const normal = read(0);
      for (let v = 0; v < 3; v++) {
        const p = read(v + 1);
        positions.set(p, t * 9 + v * 3);
        normals.set(normal, t * 9 + v * 3);
        for (let a = 0; a < 3; a++) {
          min[a] = Math.min(min[a]!, p[a]!);
          max[a] = Math.max(max[a]!, p[a]!);
        }
      }
    }
    for (const data of [positions, normals]) {
      views.push({ offset, length: data.byteLength });
      chunks.push(data);
      offset += data.byteLength;
    }
    accessors.push(
      {
        bufferView: i * 2,
        componentType: FLOAT,
        count: count * 3,
        type: 'VEC3',
        min,
        max,
      },
      {
        bufferView: i * 2 + 1,
        componentType: FLOAT,
        count: count * 3,
        type: 'VEC3',
      },
    );
    meshes.push({
      primitives: [
        { attributes: { POSITION: i * 2, NORMAL: i * 2 + 1 }, material: i },
      ],
    });
    materials.push({
      pbrMetallicRoughness: {
        baseColorFactor: [...linear(part.hex), 1],
        metallicFactor: 0.05,
        roughnessFactor: 0.55,
      },
    });
  }

  const json = new TextEncoder().encode(
    JSON.stringify({
      asset: { version: '2.0', generator: 'Forgea' },
      scene: 0,
      scenes: [{ nodes: parts.map((_, i) => i) }],
      nodes: parts.map((_, i) => ({ mesh: i })),
      meshes,
      materials,
      accessors,
      bufferViews: views.map((v) => ({
        buffer: 0,
        byteOffset: v.offset,
        byteLength: v.length,
        target: ARRAY_BUFFER,
      })),
      buffers: [{ byteLength: offset }],
    }),
  );
  // Chunks are padded to 4 bytes: JSON with spaces, the binary with zeros.
  const jsonLength = pad4(json.byteLength);
  const binLength = pad4(offset);
  const out = new Uint8Array(12 + 8 + jsonLength + 8 + binLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, out.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(json, 20);
  const bin = 20 + jsonLength;
  view.setUint32(bin, binLength, true);
  view.setUint32(bin + 4, 0x004e4942, true); // "BIN"
  let at = bin + 8;
  for (const c of chunks) {
    out.set(new Uint8Array(c.buffer, c.byteOffset, c.byteLength), at);
    at += c.byteLength;
  }
  return out;
}

const FLOAT = 5126;
const ARRAY_BUFFER = 34962;
const pad4 = (n: number) => Math.ceil(n / 4) * 4;

/** A "#rrggbb" swatch as linear RGB (glTF colours are linear). */
function linear(hex: string): [number, number, number] {
  const n = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? 'b87333';
  return [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
}
