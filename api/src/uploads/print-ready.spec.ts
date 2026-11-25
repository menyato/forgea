import { describe, expect, it } from 'vitest';
import { zipTextFiles } from '../common/zip-writer.js';
import { printFrames, printReady } from './print-ready.js';
import { threeMfEntries } from './three-mf.js';

/** A binary STL box from lo to hi. */
function boxStl(lo: number[], hi: number[]): Uint8Array {
  const c = (i: number) => [
    i & 1 ? hi[0]! : lo[0]!,
    i & 2 ? hi[1]! : lo[1]!,
    i & 4 ? hi[2]! : lo[2]!,
  ];
  const tris = [
    [0, 2, 1],
    [1, 2, 3],
    [4, 5, 6],
    [5, 7, 6],
    [0, 1, 4],
    [1, 5, 4],
    [2, 6, 3],
    [3, 6, 7],
    [0, 4, 2],
    [2, 4, 6],
    [1, 3, 5],
    [3, 7, 5],
  ];
  const b = Buffer.alloc(84 + tris.length * 50);
  b.writeUInt32LE(tris.length, 80);
  tris.forEach((t, k) =>
    t.forEach((v, j) =>
      c(v).forEach((x, a) =>
        b.writeFloatLE(x, 84 + k * 50 + 12 + j * 12 + a * 4),
      ),
    ),
  );
  return new Uint8Array(b);
}

const cube =
  '<object id="1" type="model"><mesh><vertices>' +
  [0, 1, 2, 3, 4, 5, 6, 7]
    .map(
      (i) =>
        `<vertex x="${i & 1 ? 10 : 0}" y="${i & 2 ? 20 : 0}" z="${i & 4 ? 6 : 0}"/>`,
    )
    .join('') +
  '</vertices><triangles><triangle v1="0" v2="2" v3="1"/></triangles></mesh></object>';

/** A sliced Bambu project: one object "board" (10 x 20 x 6, its own frame) at (100, 50) on the plate. */
const project = zipTextFiles([
  {
    name: '_rels/.rels',
    text: '<Relationships><Relationship Target="/3D/3dmodel.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
  },
  {
    name: '3D/3dmodel.model',
    text:
      '<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><resources>' +
      '<object id="2" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object>' +
      '</resources><build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 100 50 0" printable="1"/></build></model>',
  },
  {
    name: '3D/Objects/object_1.model',
    text: `<model unit="millimeter"><resources>${cube}</resources><build/></model>`,
  },
  {
    name: 'Metadata/model_settings.config',
    text: '<config>\n  <object id="2">\n    <metadata key="name" value="board"/>\n    <metadata key="extruder" value="1"/>\n    <part id="1" subtype="normal_part"><metadata key="extruder" value="1"/></part>\n  </object>\n</config>',
  },
  {
    name: 'Metadata/project_settings.config',
    text: JSON.stringify({ filament_colour: ['#000000', '#D4A24C'] }),
  },
  { name: 'Metadata/slice_info.config', text: '<config/>' },
  { name: 'Metadata/plate_1.gcode', text: '; old slicing' },
]);

const files = (zip: Uint8Array) => {
  const out = new Map<string, string>();
  for (const [name, e] of threeMfEntries(zip))
    out.set(name, e.read().toString('utf8'));
  return out;
};
const vertices = (xml: string, id: string) => {
  const body = new RegExp(`<object id="${id}"[^>]*>([\\s\\S]*?)</object>`).exec(
    xml,
  )![1]!;
  return [...body.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].map(
    (m) => [1, 2, 3].map((k) => Number(m[k])),
  );
};

describe("printReady: an order's text added to the print project", () => {
  it('puts a part placed on the plate into the object under it, in its frame and closest filament; the old slicing goes', () => {
    const out = printReady(project, null, [
      {
        label: 'Name: Lina (Gold)',
        hex: '#d4a24c',
        stl: boxStl([102, 55, 5.2], [108, 65, 6]),
      },
    ]);
    expect(out).not.toBeNull();
    const f = files(out!);
    expect(f.has('Metadata/plate_1.gcode')).toBe(false);
    expect(f.has('Metadata/slice_info.config')).toBe(false);
    expect(f.get('3D/3dmodel.model')).toContain(
      '<component p:path="/3D/Objects/object_1.model" objectid="3"',
    );
    expect(f.get('Metadata/model_settings.config')).toMatch(
      /<part id="3" subtype="normal_part">[\s\S]*Name: Lina \(Gold\)[\s\S]*key="extruder" value="2"/,
    );
    // In the object's own frame: the plate position minus the item's move.
    const v = vertices(f.get('3D/Objects/object_1.model')!, '3');
    expect(Math.min(...v.map((p) => p[0]!))).toBeCloseTo(2, 4);
    expect(Math.max(...v.map((p) => p[1]!))).toBeCloseTo(15, 4);
    expect(Math.max(...v.map((p) => p[2]!))).toBeCloseTo(6, 4);
  });

  it("with the shop model's frames, moves a part from the assembled piece onto the print part", () => {
    // On the assembled piece the board stands up (x 0..10, y 0..6, z 0..20), turned to lie on
    // the plate: rotation about x by -90 degrees (y -> -z, z -> y).
    const frames = [
      {
        name: 'board',
        rotation: [
          [1, 0, 0],
          [0, 0, 1],
          [0, -1, 0],
        ] as [number[], number[], number[]],
        min: [0, 0, 0] as [number, number, number],
        max: [10, 6, 20] as [number, number, number],
      },
    ];
    // Text on its front (y 0..0.8), near the top (z 15..18).
    const out = printReady(project, frames, [
      { label: 'Name', hex: '#d4a24c', stl: boxStl([2, 0, 15], [8, 0.8, 18]) },
    ]);
    const v = vertices(files(out!).get('3D/Objects/object_1.model')!, '3');
    const span = (a: number) => [
      Math.min(...v.map((p) => p[a]!)),
      Math.max(...v.map((p) => p[a]!)),
    ];
    // Lying: the front faces up (z 5.2..6 of the 6 mm part), the top towards +y.
    expect(span(2)[0]).toBeCloseTo(5.2, 4);
    expect(span(2)[1]).toBeCloseTo(6, 4);
    expect(span(1)[0]).toBeCloseTo(15, 4);
    expect(span(0)[0]).toBeCloseTo(2, 4);
  });

  it("takes the customer's colours: a recoloured part's filament becomes the chosen colour", () => {
    const out = printReady(
      project,
      null,
      [
        {
          label: 'Name',
          hex: '#d4a24c',
          stl: boxStl([102, 55, 5.2], [108, 65, 6]),
        },
      ],
      [{ from: '#000000', to: '#f2f2ee' }],
    );
    const f = files(out!);
    const settings = JSON.parse(f.get('Metadata/project_settings.config')!) as {
      filament_colour: string[];
    };
    expect(settings.filament_colour).toEqual(['#F2F2EE', '#D4A24C']);
    // The gold text still goes to the gold filament.
    expect(f.get('Metadata/model_settings.config')).toMatch(
      /<part id="3"[\s\S]*key="extruder" value="2"/,
    );
  });

  it('gives up (the caller falls back) when a part lies on no object, and reads only well-formed frames', () => {
    expect(
      printReady(project, null, [
        { label: 'x', hex: null, stl: boxStl([0, 0, 0], [1, 1, 1]) },
      ]),
    ).toBeNull();
    const model = (text: string) =>
      zipTextFiles([{ name: 'Metadata/forgea_print_frames.json', text }]);
    expect(
      printFrames(
        model(
          '{"version":1,"objects":[{"name":"base","rotation":[[1,0,0],[0,1,0],[0,0,1]],"min":[0,0,0],"max":[1,1,1]}]}',
        ),
      ),
    ).toHaveLength(1);
    expect(
      printFrames(
        model(
          '{"version":1,"objects":[{"name":"base","rotation":[[1,0]],"min":[0,0,0],"max":[1,1,1]}]}',
        ),
      ),
    ).toBeNull();
    expect(printFrames(model('not json'))).toBeNull();
    expect(
      printFrames(zipTextFiles([{ name: 'other.txt', text: '' }])),
    ).toBeNull();
  });
});
