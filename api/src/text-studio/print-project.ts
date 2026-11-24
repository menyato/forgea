import { zipTextFiles } from '../common/zip-writer.js';
import { PER_FILAMENT, X2D_ONE_FILAMENT } from './bambu-x2d.js';

/** Where the piece is set down: the middle of a 256 mm Bambu bed (X1, P1, X2D, H2D's left). */
const BED_SIZE = 256;
const BED_CENTRE = BED_SIZE / 2;
/** The Bambu project version these files follow (as Bambu Studio 2.x writes them). */
const BAMBU = 'BambuStudio-02.09.01.70';

/**
 * A piece as one 3MF project for the slicer: a single object whose parts are its colours,
 * already placed together (the STLs share one frame), set down in the middle of the bed.
 *
 * Colours are written the way Bambu Studio (and Orca) read them, which is the only way they
 * keep them: each colour is a filament of the project (`Metadata/project_settings.config`:
 * `filament_colour`), and each part names its filament (`Metadata/model_settings.config`:
 * `extruder`). Parts of the same colour share a filament. The standard 3MF materials
 * (`basematerials`) say the same for other slicers (PrusaSlicer, Cura) and viewers.
 */
export function printProject(
  title: string,
  parts: readonly { label: string; hex: string | null; stl: Uint8Array }[],
): Uint8Array {
  // One filament per colour, in the order the parts first use it.
  // A colour without a hex is told apart by its name.
  const filaments: { key: string; label: string; colour: string }[] = [];
  const filamentOf = parts.map((part) => {
    const colour = displayColour(part.hex);
    const key = colour === UNKNOWN ? `name:${part.label}` : colour;
    let n = filaments.findIndex((f) => f.key === key);
    if (n < 0) n = filaments.push({ key, label: part.label, colour }) - 1;
    return n;
  });

  const meshes = parts.map((p) => mesh(p.stl));
  const box = meshes.reduce(
    (b, m) => ({
      min: b.min.map((v, k) => Math.min(v, m.min[k]!)),
      max: b.max.map((v, k) => Math.max(v, m.max[k]!)),
    }),
    {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    },
  );
  // Centred on the bed, standing on it; a piece in several colours keeps clear of the prime
  // tower (back right), moved left or forward as little as it takes.
  const [w, d] = [box.max[0]! - box.min[0]!, box.max[1]! - box.min[1]!];
  const at = placed(w, d, filaments.length > 1);
  const shift = [
    at.x - (box.min[0]! + box.max[0]!) / 2,
    at.y - (box.min[1]! + box.max[1]!) / 2,
    -box.min[2]!,
  ].map((v) => (Number.isFinite(v) ? num(v) : '0'));

  const whole = parts.length + 2;
  const model =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">\n' +
    `<metadata name="Application">${BAMBU}</metadata>\n` +
    '<metadata name="BambuStudio:3mfVersion">1</metadata>\n' +
    `<metadata name="Title">${xml(title)}</metadata>\n` +
    '<resources><basematerials id="1">' +
    filaments
      .map((f) => `<base name="${xml(f.label)}" displaycolor="${f.colour}FF"/>`)
      .join('') +
    '</basematerials>' +
    meshes
      .map(
        (m, i) =>
          `<object id="${i + 2}" type="model" name="${xml(parts[i]!.label)}" pid="1" pindex="${filamentOf[i]}">${m.xml}</object>`,
      )
      .join('') +
    `<object id="${whole}" type="model" name="${xml(title)}"><components>` +
    parts.map((_, i) => `<component objectid="${i + 2}"/>`).join('') +
    `</components></object></resources>\n` +
    `<build><item objectid="${whole}" transform="1 0 0 0 1 0 0 0 1 ${shift.join(' ')}" printable="1"/></build>\n</model>`;

  // The object takes the biggest part's filament (its infill), each part its own.
  const biggest = meshes.reduce(
    (best, m, i) => (m.volume > meshes[best]!.volume ? i : best),
    0,
  );
  const settings =
    '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n' +
    `  <object id="${whole}">\n` +
    `    <metadata key="name" value="${xml(title)}"/>\n` +
    `    <metadata key="extruder" value="${(filamentOf[biggest] ?? 0) + 1}"/>\n` +
    parts
      .map(
        (p, i) =>
          `    <part id="${i + 2}" subtype="normal_part">\n` +
          `      <metadata key="name" value="${xml(p.label)}"/>\n` +
          '      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n' +
          `      <metadata key="extruder" value="${filamentOf[i]! + 1}"/>\n` +
          '    </part>\n',
      )
      .join('') +
    '  </object>\n</config>\n';

  const project = JSON.stringify(
    bambuSettings(
      filaments.map((f) => f.colour),
      at.tower,
    ),
    null,
    4,
  );

  return zipTextFiles([
    {
      name: '[Content_Types].xml',
      text:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
        '<Default Extension="config" ContentType="text/xml"/>' +
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
    { name: 'Metadata/model_settings.config', text: settings },
    { name: 'Metadata/project_settings.config', text: project },
  ]);
}

/**
 * A binary STL as a 3MF mesh, with its bounds and volume. STL repeats each corner in every
 * triangle; 3MF wants each vertex once, so corners at the same point become one vertex
 * (slicers then see a closed solid), and triangles that collapse to a line are left out.
 */
function mesh(stl: Uint8Array): {
  xml: string;
  min: number[];
  max: number[];
  volume: number;
} {
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const count = view.getUint32(80, true);
  const index = new Map<string, number>();
  const vertices: string[] = [];
  const triangles: string[] = [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let volume = 0;
  for (let t = 0; t < count; t++) {
    const corners: number[] = [];
    const points: number[][] = [];
    for (let v = 0; v < 3; v++) {
      const at = 84 + t * 50 + 12 + v * 12;
      const p = [0, 4, 8].map((k) => view.getFloat32(at + k, true));
      points.push(p);
      // The exact bits: the same point in two triangles is the same float.
      const key = `${view.getUint32(at, true)},${view.getUint32(at + 4, true)},${view.getUint32(at + 8, true)}`;
      let n = index.get(key);
      if (n === undefined) {
        n = vertices.length;
        index.set(key, n);
        p.forEach((x, k) => {
          min[k] = Math.min(min[k]!, x);
          max[k] = Math.max(max[k]!, x);
        });
        vertices.push(
          `<vertex x="${num(p[0]!)}" y="${num(p[1]!)}" z="${num(p[2]!)}"/>`,
        );
      }
      corners.push(n);
    }
    const [a, b, c] = corners as [number, number, number];
    if (a !== b && b !== c && a !== c) {
      triangles.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
      const [p, q, r] = points as [number[], number[], number[]];
      volume +=
        (p[0]! * (q[1]! * r[2]! - q[2]! * r[1]!) -
          p[1]! * (q[0]! * r[2]! - q[2]! * r[0]!) +
          p[2]! * (q[0]! * r[1]! - q[1]! * r[0]!)) /
        6;
    }
  }
  return {
    xml: `<mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh>`,
    min,
    max,
    volume: Math.abs(volume),
  };
}

/**
 * The project's settings for `colours.length` filaments in these colours: the X2D template's
 * filament block repeated, each filament its own number and colour, and a purge table between
 * them (more when going from a dark colour to a lighter one, as Bambu Studio itself suggests).
 */
/** The prime tower's footprint (mm), its brim included, and its corner: back right. */
const TOWER = { size: 35 + 10, x: BED_SIZE - 35 - 12, y: BED_SIZE - 35 - 12 };
/** Kept between the piece and the tower, and from the bed's edges (mm). */
const CLEAR = 8;

/**
 * Where the piece's centre goes on the bed: the middle, unless (in several colours) it would
 * reach the prime tower's corner; then as far left, or as far forward, as it must to clear it.
 */
function placed(
  w: number,
  d: number,
  tower: boolean,
): { x: number; y: number; tower: { x: number; y: number } } {
  const t = { x: TOWER.x, y: TOWER.y };
  const centre = { x: BED_CENTRE, y: BED_CENTRE, tower: t };
  if (!tower) return centre;
  const clearsX = BED_CENTRE + w / 2 <= t.x - CLEAR;
  const clearsY = BED_CENTRE + d / 2 <= t.y - CLEAR;
  if (clearsX || clearsY) return centre;
  // Left of the tower, if it fits there…
  const x = t.x - CLEAR - w / 2;
  if (x - w / 2 >= CLEAR) return { ...centre, x };
  // …or in front of it.
  const y = t.y - CLEAR - d / 2;
  if (y - d / 2 >= CLEAR) return { ...centre, y };
  // Too big for both: the tower goes to the front-left corner instead.
  return { ...centre, tower: { x: CLEAR, y: CLEAR } };
}

function bambuSettings(
  colours: readonly string[],
  tower: { x: number; y: number },
): Record<string, string | string[]> {
  const n = colours.length;
  const settings: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(X2D_ONE_FILAMENT))
    settings[key] =
      typeof value === 'string'
        ? value
        : PER_FILAMENT.includes(key)
          ? colours.flatMap(() => value)
          : [...value];
  const variants = (X2D_ONE_FILAMENT.filament_self_index as readonly string[])
    .length;
  settings.filament_colour = [...colours];
  settings.filament_self_index = colours.flatMap((_, i) =>
    Array<string>(variants).fill(String(i + 1)),
  );
  // One table per nozzle.
  const purge = colours.flatMap((from, i) =>
    colours.map((to, j) =>
      i === j
        ? '0'
        : String(
            Math.round(
              (140 + 520 * Math.max(0, luminance(to) - luminance(from))) / 10,
            ) * 10,
          ),
    ),
  );
  settings.flush_volumes_matrix = [...purge, ...purge];
  settings.wipe_tower_x = [num(tower.x)];
  settings.wipe_tower_y = [num(tower.y)];
  // [process, filament 1…n, printer]: nothing changed from Bambu's own presets.
  settings.different_settings_to_system = Array<string>(n + 2).fill('');
  settings.inherits_group = Array<string>(n + 2).fill('');
  return settings;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
  );
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

const num = (x: number) => String(Number(x.toFixed(5)));

const UNKNOWN = '#808080';
const displayColour = (hex: string | null) =>
  /^#[0-9a-f]{6}$/i.test(hex ?? '') ? hex!.toUpperCase() : UNKNOWN;

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
