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
      { label: 'Copper silk again', hex: '#B87333', stl: tetrahedron(40) },
    ]),
  );
  const model = files.get('3D/3dmodel.model')!;
  const settings = files.get('Metadata/model_settings.config')!;
  const project = JSON.parse(
    files.get('Metadata/project_settings.config')!,
  ) as Record<string, string[]>;

  it('is a Bambu Studio project', () => {
    expect([...files.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      '3D/3dmodel.model',
      'Metadata/model_settings.config',
      'Metadata/project_settings.config',
    ]);
    expect(files.get('_rels/.rels')).toContain('Target="/3D/3dmodel.model"');
    expect(model).toContain('<metadata name="Application">BambuStudio-');
  });

  it('keeps each corner once, so every part is a closed solid', () => {
    const parts = model.match(/<mesh>.*?<\/mesh>/g)!;
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part.match(/<vertex /g)).toHaveLength(4);
      expect(part.match(/<triangle /g)).toHaveLength(4);
    }
    // Placed as designed: the second part keeps its own position.
    expect(parts[1]).toContain('x="20"');
  });

  it('is one object, set down in the middle of the bed', () => {
    expect(model).toMatch(
      /<object id="5" type="model" name="FG-TEST"><components><component objectid="2"\/><component objectid="3"\/><component objectid="4"\/><\/components>/,
    );
    // 0 to 50 mm across, 0 to 10 deep and high: centred on 128, 128, on the bed.
    expect(model).toContain(
      '<item objectid="5" transform="1 0 0 0 1 0 0 0 1 103 123 0" printable="1"/>',
    );
  });

  it('gives each colour a filament of that colour, and each part its filament', () => {
    // Two copper parts share one filament; a colour without a hex has its own.
    expect(project.filament_colour).toEqual(['#B87333', '#808080']);
    expect(settings).toMatch(
      /name" value="Copper silk"\/>\s*<metadata key="matrix"[^>]*\/>\s*<metadata key="extruder" value="1"/,
    );
    expect(settings).toMatch(
      /name" value="Black &amp; white"\/>\s*<metadata key="matrix"[^>]*\/>\s*<metadata key="extruder" value="2"/,
    );
    expect(settings).toMatch(
      /name" value="Copper silk again"\/>\s*<metadata key="matrix"[^>]*\/>\s*<metadata key="extruder" value="1"/,
    );
    expect(model).toContain(
      '<base name="Copper silk" displaycolor="#B87333FF"/>',
    );
  });

  it('has every per-filament setting once per filament', () => {
    expect(project.filament_settings_id).toHaveLength(2);
    expect(project.filament_type).toHaveLength(2);
    // Per nozzle variant (six on the X2D), per filament.
    expect(project.nozzle_temperature).toHaveLength(12);
    // A purge table per nozzle: 2 x 2 each, nothing to purge into the same filament.
    expect(project.flush_volumes_matrix).toHaveLength(8);
    expect(
      project.flush_volumes_matrix!.slice(0, 4).filter((v) => v === '0'),
    ).toHaveLength(2);
    expect(project.different_settings_to_system).toHaveLength(4);
  });
});
