import { crc32, deflateRawSync } from 'node:zlib';

/**
 * A personalised piece as one 3MF project for the slicer: a single object whose parts are its
 * colours, already placed together (the STLs share one frame), each named and tinted after
 * its filament. Bambu Studio, Orca and PrusaSlicer open it as one object with a part per
 * colour, so it can be turned and laid flat as a whole and each part given its filament.
 */
export function printProject(
  title: string,
  parts: readonly { label: string; hex: string | null; stl: Uint8Array }[],
): Uint8Array {
  const objects: string[] = [];
  const colours: string[] = [];
  for (const [i, part] of parts.entries()) {
    colours.push(
      `<base name="${xml(part.label)}" displaycolor="${displayColour(part.hex)}"/>`,
    );
    objects.push(
      `<object id="${i + 2}" type="model" name="${xml(part.label)}" pid="1" pindex="${i}">${mesh(part.stl)}</object>`,
    );
  }
  const whole = parts.length + 2;
  const model =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
    `<metadata name="Title">${xml(title)}</metadata>` +
    `<resources><basematerials id="1">${colours.join('')}</basematerials>${objects.join('')}` +
    `<object id="${whole}" type="model" name="${xml(title)}"><components>` +
    parts.map((_, i) => `<component objectid="${i + 2}"/>`).join('') +
    `</components></object></resources><build><item objectid="${whole}"/></build></model>`;

  return zip([
    {
      name: '[Content_Types].xml',
      text:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      text:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
        '</Relationships>',
    },
    { name: '3D/3dmodel.model', text: model },
  ]);
}

/**
 * A binary STL as a 3MF mesh. STL repeats each corner in every triangle; 3MF wants each
 * vertex once, so corners at the same point become one vertex (slicers then see a closed
 * solid), and triangles that collapse to a line are left out.
 */
function mesh(stl: Uint8Array): string {
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const count = view.getUint32(80, true);
  const index = new Map<string, number>();
  const vertices: string[] = [];
  const triangles: string[] = [];
  for (let t = 0; t < count; t++) {
    const corners: number[] = [];
    for (let v = 0; v < 3; v++) {
      const at = 84 + t * 50 + 12 + v * 12;
      // The exact bits: the same point in two triangles is the same float.
      const key = `${view.getUint32(at, true)},${view.getUint32(at + 4, true)},${view.getUint32(at + 8, true)}`;
      let n = index.get(key);
      if (n === undefined) {
        n = vertices.length;
        index.set(key, n);
        const [x, y, z] = [0, 4, 8].map((k) =>
          num(view.getFloat32(at + k, true)),
        );
        vertices.push(`<vertex x="${x}" y="${y}" z="${z}"/>`);
      }
      corners.push(n);
    }
    const [a, b, c] = corners as [number, number, number];
    if (a !== b && b !== c && a !== c)
      triangles.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
  }
  return `<mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh>`;
}

const num = (x: number) => String(Number(x.toFixed(5)));

const displayColour = (hex: string | null) =>
  /^#[0-9a-f]{6}$/i.test(hex ?? '') ? `${hex!.toUpperCase()}FF` : '#808080FF';

const xml = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]!,
  );

/** A zip of a few text files, deflated: all a 3MF package needs. */
function zip(files: readonly { name: string; text: string }[]): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const raw = Buffer.from(file.text, 'utf8');
    const packed = deflateRawSync(raw);
    const crc = crc32(raw);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0800, 6); // names in UTF-8
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt32LE(0, 10); // time and date: none
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(0, 12);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42); // the rest (extra, comment, disk, attributes) stays 0
    local.push(header, name, packed);
    central.push(entry, name);
    offset += header.length + name.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, directory, end]));
}
