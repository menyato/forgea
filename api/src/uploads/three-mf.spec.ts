import { bambuThreeMf } from '../../test/three-mf-file.js';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { zipTextFiles } from '../common/zip-writer.js';
import { paintState, readThreeMf } from './three-mf.js';
import { zipEntries } from './zip-reader.js';

const CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const PROD = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';

/** A closed box mesh (12 triangles) from (x0,y0,z0) to (x1,y1,z1), as 3MF XML. */
function box(
  [x0, y0, z0]: number[],
  [x1, y1, z1]: number[],
  paint: (i: number) => string | null = () => null,
): string {
  const v = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  const t = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ];
  return (
    '<mesh><vertices>' +
    v.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join('') +
    '</vertices><triangles>' +
    t
      .map(([a, b, c], i) => {
        const p = paint(i);
        return `<triangle v1="${a}" v2="${b}" v3="${c}"${p ? ` paint_color="${p}"` : ''}/>`;
      })
      .join('') +
    '</triangles></mesh>'
  );
}

const rels = {
  name: '_rels/.rels',
  text: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`,
};

const settings = (colours: string[]) => ({
  name: 'Metadata/project_settings.config',
  text: JSON.stringify({
    filament_colour: colours,
    filament_type: colours.map(() => 'PLA'),
    wall_loops: '2',
  }),
});

/**
 * A Bambu Studio project: one object of two parts (a 20 mm cube in filament 1 and a 10 mm
 * cube in filament 2), kept in a separate file of the archive, placed by the build.
 */
function bambuProject(extra: { name: string; text: string }[] = []) {
  return zipTextFiles([
    rels,
    {
      name: '3D/3dmodel.model',
      text: `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE}" xmlns:p="${PROD}" requiredextensions="p"><resources><object id="3" type="model"><components><component p:path="/3D/Objects/piece.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/><component p:path="/3D/Objects/piece.model" objectid="2" transform="1 0 0 0 1 0 0 0 1 20 0 0"/></components></object></resources><build><item objectid="3" transform="1 0 0 0 1 0 0 0 1 100 100 0"/></build></model>`,
    },
    {
      name: '3D/Objects/piece.model',
      text: `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE}"><resources><object id="1" type="model">${box([0, 0, 0], [20, 20, 20])}</object><object id="2" type="model">${box([0, 0, 0], [10, 10, 10])}</object></resources></model>`,
    },
    {
      name: 'Metadata/model_settings.config',
      text: `<?xml version="1.0"?><config><object id="3"><metadata key="name" value="piece"/><metadata key="extruder" value="1"/><part id="1" subtype="normal_part"><metadata key="extruder" value="1"/></part><part id="2" subtype="normal_part"><metadata key="extruder" value="2"/></part></object></config>`,
    },
    settings(['#FFFFFF', '#000000']),
    ...extra,
  ]);
}

describe('readThreeMf', () => {
  it('reads a Bambu project: parts by filament, placed by the build, with volumes', () => {
    const { info, parts } = readThreeMf(bambuProject());
    expect(info.sizeMm).toEqual([30, 20, 20]);
    expect(info.triangles).toBe(24);
    expect(info.printSeconds).toBeNull();
    expect(info.colours).toEqual([
      { slot: 1, hex: '#ffffff', type: 'PLA', volumeMm3: 8000, grams: null },
      { slot: 2, hex: '#000000', type: 'PLA', volumeMm3: 1000, grams: null },
    ]);
    expect(parts.map((p) => [p.slot, p.positions.length / 9])).toEqual([
      [1, 12],
      [2, 12],
    ]);
    // Placed where the build puts it (the second part 20 mm along).
    const xs = parts.flatMap((p) =>
      [...p.positions].filter((_, i) => i % 3 === 0),
    );
    expect(Math.min(...xs)).toBe(100);
    expect(Math.max(...xs)).toBe(130);
  });

  it("takes a sliced file's time and grams per filament from the slicer", () => {
    const { info } = readThreeMf(
      bambuProject([
        {
          name: 'Metadata/slice_info.config',
          text: `<?xml version="1.0"?><config><plate><metadata key="index" value="1"/><metadata key="prediction" value="5400"/><metadata key="weight" value="12.5"/><filament id="1" type="PLA" color="#FFFFFF" used_m="3" used_g="10.25"/><filament id="2" type="PETG" color="#000000" used_m="1" used_g="2.25"/></plate></config>`,
        },
      ]),
    );
    expect(info.printSeconds).toBe(5400);
    expect(info.colours.map((c) => [c.slot, c.type, c.grams])).toEqual([
      [1, 'PLA', 10.25],
      [2, 'PETG', 2.25],
    ]);
  });

  it('keeps how the file was set up to print, as plain text', () => {
    const { info } = readThreeMf(bambuThreeMf({ sliced: true }));
    expect(info.setup).toEqual({
      plates: 1,
      supports: true,
      primeTower: true,
      printer: 'Bambu Lab X2D',
      nozzleMm: 0.4,
      layerHeightMm: 0.12,
      infill: '15%',
      profile: '0.12mm Fine @BBL X2D',
      // A skipped object isn't printed; markup signs never come through.
      objects: ['piece b'],
    });
    // Never sliced: no plates, and nothing made up.
    expect(readThreeMf(bambuProject()).info.setup).toMatchObject({
      plates: 0,
      supports: false,
      printer: null,
      objects: [],
    });
  });

  it('leaves out modifiers and negative parts', () => {
    const data = zipTextFiles([
      rels,
      {
        name: '3D/3dmodel.model',
        text: `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE}"><resources><object id="1" type="model">${box([0, 0, 0], [10, 10, 10])}</object><object id="2" type="model">${box([0, 0, 0], [50, 50, 50])}</object><object id="3" type="model"><components><component objectid="1"/><component objectid="2"/></components></object></resources><build><item objectid="3"/></build></model>`,
      },
      {
        name: 'Metadata/model_settings.config',
        text: `<config><object id="3"><part id="1" subtype="normal_part"/><part id="2" subtype="modifier_part"/></object></config>`,
      },
    ]);
    expect(readThreeMf(data).info.sizeMm).toEqual([10, 10, 10]);
  });

  it('colours painted triangles and moves a shell of their area to the paint', () => {
    const data = zipTextFiles([
      rels,
      {
        name: '3D/3dmodel.model',
        // The top face (triangles 2 and 3) painted in filament 2 ("8": state 2).
        text: `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE}"><resources><object id="1" type="model">${box([0, 0, 0], [10, 10, 10], (i) => (i === 2 || i === 3 ? '8' : null))}</object></resources><build><item objectid="1"/></build></model>`,
      },
      settings(['#FFFFFF', '#FF0000']),
    ]);
    const { info, parts } = readThreeMf(data);
    expect(parts.map((p) => [p.slot, p.positions.length / 9])).toEqual([
      [1, 10],
      [2, 2],
    ]);
    // 100 mm² painted × 2 walls × 0.42 mm.
    const red = info.colours.find((c) => c.slot === 2)!;
    expect(red.volumeMm3).toBeCloseTo(84, 5);
    expect(info.colours.find((c) => c.slot === 1)!.volumeMm3).toBeCloseTo(
      916,
      5,
    );
  });

  it('reads base-material colours (3MF core, e.g. our own print projects)', () => {
    const data = zipTextFiles([
      rels,
      {
        name: '3D/3dmodel.model',
        text: `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE}"><resources><basematerials id="9"><base name="Copper" displaycolor="#B87333FF"/></basematerials><object id="1" type="model" pid="9" pindex="0">${box([0, 0, 0], [10, 10, 10])}</object></resources><build><item objectid="1"/></build></model>`,
      },
    ]);
    const { info } = readThreeMf(data);
    expect(info.colours.map((c) => c.hex)).toEqual(['#b87333']);
  });

  it('converts other units to millimetres', () => {
    const data = zipTextFiles([
      rels,
      {
        name: '3D/3dmodel.model',
        text: `<?xml version="1.0"?><model unit="centimeter" xmlns="${CORE}"><resources><object id="1" type="model">${box([0, 0, 0], [2, 2, 2])}</object></resources><build><item objectid="1"/></build></model>`,
      },
    ]);
    expect(readThreeMf(data).info.sizeMm).toEqual([20, 20, 20]);
  });

  it('refuses files it cannot use, with a reason', () => {
    expect(() => readThreeMf(new Uint8Array([1, 2, 3]))).toThrow(/zip/);
    expect(() =>
      readThreeMf(
        zipTextFiles([
          rels,
          {
            name: '3D/3dmodel.model',
            text: `<model xmlns="${CORE}"><resources/><build/></model>`,
          },
        ]),
      ),
    ).toThrow(/no printable model/);
    // A triangle naming a vertex that isn't there.
    expect(() =>
      readThreeMf(
        zipTextFiles([
          rels,
          {
            name: '3D/3dmodel.model',
            text: `<model xmlns="${CORE}"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`,
          },
        ]),
      ),
    ).toThrow(/missing vertex/);
    // Components that point at each other in a loop.
    expect(() =>
      readThreeMf(
        zipTextFiles([
          rels,
          {
            name: '3D/3dmodel.model',
            text: `<model xmlns="${CORE}"><resources><object id="1" type="model"><components><component objectid="2"/></components></object><object id="2" type="model"><components><component objectid="1"/></components></object></resources><build><item objectid="1"/></build></model>`,
          },
        ]),
      ),
    ).toThrow(/nests too deeply/);
  });
});

describe('paintState', () => {
  it('reads whole and split triangles', () => {
    expect(paintState('4')).toEqual([1, 1]);
    expect(paintState('8')).toEqual([2, 1]);
    // State 3 and up take a second nibble: "0C" = 12 then 0 → state 3.
    expect(paintState('0C')).toEqual([3, 1]);
    // Split in four (code 3), three unpainted quarters and one in state 2.
    expect(paintState('80003')).toEqual([0, 0]);
    expect(paintState('88803')).toEqual([2, 0.75]);
    expect(paintState('zz')).toEqual([0, 0]);
  });
});

describe('zipEntries', () => {
  it('never unpacks an entry past its limit, whatever the header says', () => {
    // 50 MB of zeros, deflated to a few KB, with a header claiming 10 bytes.
    const bomb = deflateRawSync(Buffer.alloc(50 * 1024 * 1024));
    const data = zipTextFiles([{ name: 'a.txt', text: 'x' }]);
    const buf = Buffer.from(data);
    // Rebuild by hand: same layout, the bomb as the body, a lying size.
    const name = Buffer.from('a.txt');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(bomb.length, 18);
    local.writeUInt32LE(10, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(bomb.length, 20);
    central.writeUInt32LE(10, 24);
    central.writeUInt16LE(name.length, 28);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(46 + name.length, 12);
    end.writeUInt32LE(30 + name.length + bomb.length, 16);
    const archive = Buffer.concat([local, name, bomb, central, name, end]);
    expect(buf.length).toBeGreaterThan(0);
    const [entry] = zipEntries(archive, {
      maxEntries: 10,
      maxEntryBytes: 1024 * 1024,
      maxTotalBytes: 1024 * 1024,
    });
    expect(() => entry!.read()).toThrow();
  });

  it('refuses archives with too many entries', () => {
    const data = zipTextFiles(
      Array.from({ length: 5 }, (_, i) => ({ name: `${i}.txt`, text: 'x' })),
    );
    expect(() =>
      zipEntries(data, {
        maxEntries: 4,
        maxEntryBytes: 100,
        maxTotalBytes: 100,
      }),
    ).toThrow(/Too many files/);
  });

  it('stops an archive whose entries together unpack past its total', () => {
    const data = zipTextFiles(
      Array.from({ length: 3 }, (_, i) => ({
        name: `${i}.txt`,
        text: 'x'.repeat(40),
      })),
    );
    const entries = zipEntries(data, {
      maxEntries: 10,
      maxEntryBytes: 100,
      maxTotalBytes: 100,
    });
    expect(entries[0]!.read().length).toBe(40);
    expect(entries[1]!.read().length).toBe(40);
    expect(() => entries[2]!.read()).toThrow(/too much data/);
    // And a caller's own smaller limit for one entry.
    expect(() =>
      zipEntries(data, {
        maxEntries: 10,
        maxEntryBytes: 100,
        maxTotalBytes: 1000,
      })[0]!.read(10),
    ).toThrow(/too large/);
  });
});
