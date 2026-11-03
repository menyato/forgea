import { crc32, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { printProject } from './print-project.js';

/** A binary STL of a tetrahedron shifted by `dx`: 4 corners, each in 3 of its 4 triangles. */
function tetrahedron(dx: number): Uint8Array {
  const p = [
    [dx, 0, 0],
    [dx + 10, 0, 0],
    [dx, 10, 0],
    [dx, 0, 10],
  ];
  const faces = [
    [0, 2, 1],
    [0, 1, 3],
    [0, 3, 2],
    [1, 2, 3],
  ];
  const bytes = new Uint8Array(84 + faces.length * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, faces.length, true);
  faces.forEach((f, t) =>
    f.forEach((corner, v) =>
      p[corner]!.forEach((x, k) =>
        view.setFloat32(84 + t * 50 + 12 + v * 12 + k * 4, x, true),
      ),
    ),
  );
  return bytes;
}

/** The files in a zip, read from its local headers. */
function unzip(zip: Uint8Array): Map<string, string> {
  const buf = Buffer.from(zip);
  const files = new Map<string, string>();
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLength = buf.readUInt16LE(at + 26);
    const name = buf.toString('utf8', at + 30, at + 30 + nameLength);
    const start = at + 30 + nameLength;
    const raw = inflateRawSync(buf.subarray(start, start + size));
    expect(crc32(raw)).toBe(buf.readUInt32LE(at + 14));
    files.set(name, raw.toString('utf8'));
    at = start + size;
  }
  return files;
}

describe('printProject', () => {
  const files = unzip(
    printProject('FG-TEST', [
      { label: 'Copper silk', hex: '#b87333', stl: tetrahedron(0) },
      { label: 'Black & white', hex: null, stl: tetrahedron(20) },
    ]),
  );
  const model = files.get('3D/3dmodel.model')!;

  it('is a 3MF package', () => {
    expect([...files.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      '3D/3dmodel.model',
    ]);
    expect(files.get('_rels/.rels')).toContain('Target="/3D/3dmodel.model"');
  });

  it('keeps each corner once, so every part is a closed solid', () => {
    const parts = model.match(/<mesh>.*?<\/mesh>/g)!;
    expect(parts).toHaveLength(2);
    for (const part of parts) {
      expect(part.match(/<vertex /g)).toHaveLength(4);
      expect(part.match(/<triangle /g)).toHaveLength(4);
    }
    // Placed as designed: the second part keeps its own position.
    expect(parts[1]).toContain('x="20"');
  });

  it('is one object with a part per colour, named and tinted after its filament', () => {
    expect(model).toContain(
      '<base name="Copper silk" displaycolor="#B87333FF"/>',
    );
    expect(model).toContain('name="Black &amp; white"');
    expect(model).toContain('displaycolor="#808080FF"');
    expect(model).toMatch(
      /<object id="4" type="model" name="FG-TEST"><components><component objectid="2"\/><component objectid="3"\/><\/components>/,
    );
    expect(model).toContain('<build><item objectid="4"/></build>');
  });
});
