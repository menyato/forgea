import { zipTextFiles } from '../src/common/zip-writer.js';

const CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const PROD = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';

/** A closed box (12 triangles), millimetres, as a 3MF mesh. */
function box(size: number): string {
  const s = size;
  const v = [
    [0, 0, 0],
    [s, 0, 0],
    [s, s, 0],
    [0, s, 0],
    [0, 0, s],
    [s, 0, s],
    [s, s, s],
    [0, s, s],
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
    t.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join('') +
    '</triangles></mesh>'
  );
}

/**
 * A Bambu Studio project as the slicer saves it: one object of two parts, a 20 mm cube in
 * filament 1 (#AA2222) and a 10 mm cube in filament 2 (#B87333), kept in a separate model
 * file. `sliced`: with the slicer's plate (1 h 30, 10.25 g + 2.25 g), as "Export plate sliced
 * file" makes it.
 */
export function bambuThreeMf({
  sliced,
  doctored = false,
}: {
  sliced: boolean;
  /** Its slicer's numbers edited down by hand (a minute, a hundredth of a gram). */
  doctored?: boolean;
}): Buffer {
  const claims = (text: string) =>
    doctored
      ? text
          .replace('value="5400"', 'value="60"')
          .replace('used_g="10.25"', 'used_g="0.01"')
          .replace('used_g="2.25"', 'used_g="0.01"')
      : text;
  return Buffer.from(
    zipTextFiles([
      {
        name: '[Content_Types].xml',
        text: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
      },
      {
        name: '_rels/.rels',
        text: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
      },
      {
        name: '3D/3dmodel.model',
        text: `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE}" xmlns:p="${PROD}" requiredextensions="p"><resources><object id="3" type="model"><components><component p:path="/3D/Objects/piece.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/><component p:path="/3D/Objects/piece.model" objectid="2" transform="1 0 0 0 1 0 0 0 1 20 0 0"/></components></object></resources><build><item objectid="3" transform="1 0 0 0 1 0 0 0 1 128 128 0"/></build></model>`,
      },
      {
        name: '3D/Objects/piece.model',
        text: `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE}"><resources><object id="1" type="model">${box(20)}</object><object id="2" type="model">${box(10)}</object></resources></model>`,
      },
      {
        name: 'Metadata/model_settings.config',
        text: '<?xml version="1.0"?><config><object id="3"><metadata key="name" value="piece"/><metadata key="extruder" value="1"/><part id="1" subtype="normal_part"><metadata key="extruder" value="1"/></part><part id="2" subtype="normal_part"><metadata key="extruder" value="2"/></part></object></config>',
      },
      {
        name: 'Metadata/project_settings.config',
        text: JSON.stringify({
          filament_colour: ['#AA2222', '#B87333'],
          filament_type: ['PLA', 'PLA'],
          wall_loops: '2',
          enable_prime_tower: '1',
          printer_model: 'Bambu Lab X2D',
          nozzle_diameter: ['0.4', '0.4'],
          layer_height: '0.12',
          sparse_infill_density: '15%',
          print_settings_id: '0.12mm Fine @BBL X2D',
        }),
      },
      ...(sliced
        ? [
            {
              name: 'Metadata/slice_info.config',
              text: claims(
                '<?xml version="1.0"?><config><plate><metadata key="index" value="1"/><metadata key="prediction" value="5400"/><metadata key="weight" value="12.5"/><metadata key="support_used" value="true"/><object identify_id="1" name="piece &lt;b&gt;" skipped="false" /><object identify_id="2" name="left out" skipped="true" /><filament id="1" type="PLA" color="#AA2222" used_m="3" used_g="10.25"/><filament id="2" type="PLA" color="#B87333" used_m="1" used_g="2.25"/></plate></config>',
              ),
            },
            {
              name: 'Metadata/plate_1.gcode',
              text: '; G-code is never read\n',
            },
          ]
        : []),
    ]),
  );
}
