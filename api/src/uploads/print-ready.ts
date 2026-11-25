import { stlPositions } from '@forgea/pricing';
import { zipTextFiles } from '../common/zip-writer.js';
import { zipEntries } from './zip-reader.js';
import {
  projectStructure,
  threeMfEntries,
  type ProjectObject,
} from './three-mf.js';

/**
 * Where a print part sits on the assembled piece: written by the studio's build scripts into the
 * shop model (`Metadata/forgea_print_frames.json`, profession-trophies/cad/make_trophy_3mf.py).
 * `rotation` turns the part from the assembled piece to how it lies on its plate; `min`/`max` are
 * its box on the assembled piece, in the coordinates the site reads that model in.
 */
export interface PrintFrame {
  name: string;
  rotation: [number[], number[], number[]];
  min: [number, number, number];
  max: [number, number, number];
}

/** A part to add: an STL in the shop model's frame, and the colour it prints in. */
export interface ExtraPart {
  label: string;
  hex: string | null;
  stl: Uint8Array;
}

/** How far outside a part's box an added part's centre may be and still belong to it (mm). */
const REACH_MM = 3;
const FRAMES_FILE = 'Metadata/forgea_print_frames.json';
const IDENTITY_4X4 = '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1';

/** The print frames a shop model carries, or null when it has none (or they don't read). */
export function printFrames(model: Uint8Array): PrintFrame[] | null {
  let text: string | null = null;
  try {
    for (const e of zipEntries(model, {
      maxEntries: 10_000,
      maxEntryBytes: 1024 * 1024,
      maxTotalBytes: 1024 * 1024,
    })) {
      if (e.name.replace(/^\/+/, '') === FRAMES_FILE && e.size < 1024 * 1024) {
        text = e.read(1024 * 1024).toString('utf8');
      }
    }
  } catch {
    return null;
  }
  if (text === null) return null;
  try {
    const json = JSON.parse(text) as { version?: unknown; objects?: unknown };
    if (json.version !== 1 || !Array.isArray(json.objects)) return null;
    const finite = (v: unknown, n: number): v is number[] =>
      Array.isArray(v) &&
      v.length === n &&
      v.every((x) => typeof x === 'number' && Number.isFinite(x));
    const frames: PrintFrame[] = [];
    for (const o of json.objects as Record<string, unknown>[]) {
      const r = o['rotation'];
      if (
        typeof o['name'] !== 'string' ||
        !Array.isArray(r) ||
        r.length !== 3 ||
        !r.every((row) => finite(row, 3)) ||
        !finite(o['min'], 3) ||
        !finite(o['max'], 3)
      )
        return null;
      frames.push({
        name: o['name'],
        rotation: r as PrintFrame['rotation'],
        min: o['min'] as PrintFrame['min'],
        max: o['max'] as PrintFrame['max'],
      });
    }
    return frames;
  } catch {
    return null;
  }
}

/**
 * A slicer project (the product's print file, or its model when that is the project) with more
 * parts added to its objects: each part goes into the object it lies on, in that object's own
 * frame, printed in the project's filament closest to its colour. The plates, filaments and
 * settings stay as they are; the old slicing results are left out, so the slicer slices it again
 * with the new parts: open it, slice, print.
 *
 * `frames` (from the shop model) place parts given in the assembled piece's frame onto print
 * parts laid out elsewhere; without them the parts are in the project's own plate frame (the
 * shop model is this project). Null when a part lies on no object: the caller falls back.
 */
export function printReady(
  project: Uint8Array,
  frames: readonly PrintFrame[] | null,
  extras: readonly ExtraPart[],
  recolours: readonly Recolour[] = [],
): Uint8Array | null {
  const entries = threeMfEntries(project);
  const structure = projectStructure(entries);
  if (!structure || extras.length === 0) return null;
  const text = new Map<string, string>();
  const read = (path: string) => {
    let t = text.get(path);
    if (t === undefined) {
      t = entries.get(path)!.read().toString('utf8');
      text.set(path, t);
    }
    return t;
  };
  // The parts the customer recoloured: their filaments take the chosen colours, so the slicer
  // shows (and asks for) what was ordered; the order's text then goes to the closest of those.
  const colours = structure.colours.map((c) => {
    const to = recolours.find((r) => sameHex(r.from, c));
    return to ? to.to : c;
  });
  const root = read(structure.rootPath);
  if (!/xmlns:p="/.test(root)) return null;
  let settings = read('Metadata/model_settings.config');

  // New mesh ids: above every id any model file uses.
  let nextId = 0;
  for (const [path] of entries) {
    if (!path.endsWith('.model')) continue;
    for (const m of read(path).matchAll(/<object\s[^>]*\bid="(\d+)"/g)) {
      nextId = Math.max(nextId, Number(m[1]));
    }
  }

  const added = new Map<string, string[]>(); // part file -> new mesh objects
  const components = new Map<string, string[]>(); // object id -> new components
  const parts = new Map<string, string[]>(); // object id -> new model_settings parts

  for (const extra of extras) {
    const points = stlPositions(extra.stl);
    if (points.length < 9) continue;
    const centre = boxCentre(points);
    const target = frames
      ? framed(structure.objects, frames, centre)
      : placed(structure.objects, centre);
    if (!target) return null;
    const { object, toLocal } = target;
    const id = String(++nextId);
    added.set(object.partFile, [
      ...(added.get(object.partFile) ?? []),
      meshXml(id, points, toLocal),
    ]);
    components.set(object.id, [
      ...(components.get(object.id) ?? []),
      `<component p:path="/${object.partFile}" objectid="${id}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`,
    ]);
    const extruder = closest(colours, extra.hex);
    parts.set(object.id, [
      ...(parts.get(object.id) ?? []),
      `    <part id="${id}" subtype="normal_part">\n` +
        `      <metadata key="name" value="${escapeXml(extra.label)}"/>\n` +
        `      <metadata key="matrix" value="${IDENTITY_4X4}"/>\n` +
        (extruder
          ? `      <metadata key="extruder" value="${extruder}"/>\n`
          : '') +
        `    </part>`,
    ]);
  }

  // The root model: the new components inside their objects.
  let rootOut = root;
  for (const [objectId, list] of components) {
    const at = tagStart(rootOut, 'object', objectId);
    const end = at < 0 ? -1 : rootOut.indexOf('</components>', at);
    if (end < 0) return null;
    rootOut = rootOut.slice(0, end) + list.join('') + rootOut.slice(end);
  }
  // model_settings: the new parts, each naming its filament.
  for (const [objectId, list] of parts) {
    const at = tagStart(settings, 'object', objectId);
    const end = at < 0 ? -1 : settings.indexOf('</object>', at);
    if (end < 0) return null;
    settings =
      settings.slice(0, end) + list.join('\n') + '\n  ' + settings.slice(end);
  }

  const files: { name: string; text: string }[] = [];
  for (const [path] of entries) {
    // The slicing results (G-code, its plate data and pictures) are left out: sliced again.
    if (
      /^Metadata\/plate_\d+/.test(path) ||
      /^Metadata\/(top|pick)_\d+/.test(path) ||
      path === 'Metadata/slice_info.config' ||
      path === 'Metadata/_rels/model_settings.config.rels' ||
      !/\.(model|config|rels|xml|json)$/.test(path)
    )
      continue;
    let t: string;
    if (path === structure.rootPath) t = rootOut;
    else if (path === 'Metadata/model_settings.config') t = settings;
    else if (path === 'Metadata/project_settings.config' && recolours.length)
      t = withColours(read(path), colours);
    else t = read(path);
    const more = added.get(path);
    if (more) {
      const end = t.lastIndexOf('</resources>');
      if (end < 0) return null;
      t = t.slice(0, end) + more.join('') + t.slice(end);
    }
    files.push({ name: path, text: t });
  }
  return zipTextFiles(files);
}

/** A part recoloured on the order: its file colour, and the colour chosen for it (hex). */
export interface Recolour {
  from: string;
  to: string;
}

const sameHex = (a: string, b: string) =>
  a.replace('#', '').slice(0, 6).toLowerCase() ===
  b.replace('#', '').slice(0, 6).toLowerCase();

/** The project settings with these filament colours (the slicer reads `filament_colour`). */
function withColours(json: string, colours: readonly string[]): string {
  try {
    const settings = JSON.parse(json) as Record<string, unknown>;
    if (!Array.isArray(settings['filament_colour'])) return json;
    settings['filament_colour'] = colours.map((c) =>
      /^#[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() : c,
    );
    return JSON.stringify(settings, null, 4);
  } catch {
    return json;
  }
}

type ToLocal = (
  p: readonly [number, number, number],
) => [number, number, number];

/** With frames: the print part whose box on the assembled piece holds the point. */
function framed(
  objects: readonly ProjectObject[],
  frames: readonly PrintFrame[],
  centre: [number, number, number],
): { object: ProjectObject; toLocal: ToLocal } | null {
  const inside = frames
    .filter((f) =>
      [0, 1, 2].every(
        (a) =>
          centre[a]! >= f.min[a]! - REACH_MM &&
          centre[a]! <= f.max[a]! + REACH_MM,
      ),
    )
    .sort((a, b) => volume(a) - volume(b));
  for (const frame of inside) {
    const object = objects.find((o) => o.name === frame.name);
    if (!object) continue;
    const R = frame.rotation;
    const from = [0, 1, 2].map((a) => (frame.min[a]! + frame.max[a]!) / 2);
    const to = [0, 1, 2].map((a) => (object.min[a]! + object.max[a]!) / 2);
    return {
      object,
      toLocal: (p) => {
        const d = [p[0] - from[0]!, p[1] - from[1]!, p[2] - from[2]!];
        return [0, 1, 2].map(
          (r) =>
            R[r]![0]! * d[0]! + R[r]![1]! * d[1]! + R[r]![2]! * d[2]! + to[r]!,
        ) as [number, number, number];
      },
    };
  }
  return null;
}

/** Without frames: the object (as placed on its plate) whose box holds the point. */
function placed(
  objects: readonly ProjectObject[],
  centre: [number, number, number],
): { object: ProjectObject; toLocal: ToLocal } | null {
  let best: { object: ProjectObject; size: number } | null = null;
  for (const object of objects) {
    const t = object.item;
    const corners: number[][] = [];
    for (const x of [object.min[0], object.max[0]])
      for (const y of [object.min[1], object.max[1]])
        for (const z of [object.min[2], object.max[2]])
          corners.push(apply(t, [x, y, z]));
    const lo = [0, 1, 2].map((a) => Math.min(...corners.map((c) => c[a]!)));
    const hi = [0, 1, 2].map((a) => Math.max(...corners.map((c) => c[a]!)));
    if (
      ![0, 1, 2].every(
        (a) =>
          centre[a]! >= lo[a]! - REACH_MM && centre[a]! <= hi[a]! + REACH_MM,
      )
    )
      continue;
    const size = (hi[0]! - lo[0]!) * (hi[1]! - lo[1]!) * (hi[2]! - lo[2]!);
    if (!best || size < best.size) best = { object, size };
  }
  if (!best) return null;
  const inverse = invert(best.object.item);
  if (!inverse) return null;
  return { object: best.object, toLocal: (p) => apply(inverse, p) };
}

/** A point through a 3MF transform (12 numbers: three columns' rows, then the move). */
function apply(
  t: readonly number[],
  p: readonly number[],
): [number, number, number] {
  const [x, y, z] = p as [number, number, number];
  return [
    x * t[0]! + y * t[3]! + z * t[6]! + t[9]!,
    x * t[1]! + y * t[4]! + z * t[7]! + t[10]!,
    x * t[2]! + y * t[5]! + z * t[8]! + t[11]!,
  ];
}

/** The inverse of a 3MF transform, or null when it doesn't have one. */
function invert(t: readonly number[]): number[] | null {
  // p' = p·A + b (row vector): A's rows are (t0 t1 t2), (t3 t4 t5), (t6 t7 t8).
  const [a, b, c, d, e, f, g, h, i] = t as number[] as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;
  const inv = [
    (e * i - f * h) / det,
    (c * h - b * i) / det,
    (b * f - c * e) / det,
    (f * g - d * i) / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    (d * h - e * g) / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ];
  const [tx, ty, tz] = [t[9]!, t[10]!, t[11]!];
  return [
    ...inv,
    -(tx * inv[0]! + ty * inv[3]! + tz * inv[6]!),
    -(tx * inv[1]! + ty * inv[4]! + tz * inv[7]!),
    -(tx * inv[2]! + ty * inv[5]! + tz * inv[8]!),
  ];
}

function boxCentre(points: Float32Array): [number, number, number] {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a]!, points[i + a]!);
      hi[a] = Math.max(hi[a]!, points[i + a]!);
    }
  }
  return [0, 1, 2].map((a) => (lo[a]! + hi[a]!) / 2) as [
    number,
    number,
    number,
  ];
}

function volume(f: PrintFrame): number {
  return (f.max[0] - f.min[0]) * (f.max[1] - f.min[1]) * (f.max[2] - f.min[2]);
}

/** Triangle soup → a 3MF mesh object, corners shared, each moved into the object's frame. */
function meshXml(id: string, points: Float32Array, toLocal: ToLocal): string {
  const index = new Map<string, number>();
  const vertices: string[] = [];
  const triangles: string[] = [];
  for (let t = 0; t < points.length; t += 9) {
    const corner: number[] = [];
    for (let v = 0; v < 3; v++) {
      const at = t + v * 3;
      const key = `${points[at]},${points[at + 1]},${points[at + 2]}`;
      let n = index.get(key);
      if (n === undefined) {
        n = vertices.length;
        index.set(key, n);
        const [x, y, z] = toLocal([
          points[at]!,
          points[at + 1]!,
          points[at + 2]!,
        ]);
        vertices.push(
          `<vertex x="${fixed(x)}" y="${fixed(y)}" z="${fixed(z)}"/>`,
        );
      }
      corner.push(n);
    }
    const [a, b, c] = corner as [number, number, number];
    if (a !== b && b !== c && a !== c)
      triangles.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
  }
  return (
    `<object id="${id}" type="model"><mesh><vertices>${vertices.join('')}</vertices>` +
    `<triangles>${triangles.join('')}</triangles></mesh></object>`
  );
}

const fixed = (v: number) =>
  Math.abs(v) < 5e-7 ? '0' : v.toFixed(6).replace(/\.?0+$/, '');

/** The project's filament (1-based) closest in colour, or null to keep the object's own. */
function closest(
  colours: readonly string[],
  hex: string | null,
): number | null {
  const rgb = (h: string) => {
    const m = /^#?([0-9a-f]{6})/i.exec(h);
    return m ? [0, 2, 4].map((k) => parseInt(m[1]!.slice(k, k + 2), 16)) : null;
  };
  const want = hex ? rgb(hex) : null;
  if (!want || colours.length === 0) return null;
  let best = 0;
  let bestD = Infinity;
  colours.forEach((c, i) => {
    const have = rgb(c);
    if (!have) return;
    const d = have.reduce((s, v, k) => s + (v - want[k]!) ** 2, 0);
    if (d < bestD) [best, bestD] = [i, d];
  });
  return best + 1;
}

/** Where `<tag … id="ID"` starts, or -1. */
function tagStart(xml: string, tag: string, id: string): number {
  const re = new RegExp(`<${tag}\\b[^>]*\\bid="${id.replace(/\D/g, '')}"`, 'g');
  const m = re.exec(xml);
  return m ? m.index : -1;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u001f\u007f]/g, '');
}
