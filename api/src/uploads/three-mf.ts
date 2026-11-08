import { zipEntries, type ZipEntry } from './zip-reader.js';

/**
 * Reading a 3MF file: the model, its colours and, for Bambu Studio files, what the slicer
 * said it takes. Runs only in the 3D worker (model-worker.ts), never on the API's main thread.
 *
 * Understood: the 3MF core (meshes, components, build items, transforms, units, base
 * materials' display colours), the production extension (objects in other files of the
 * archive), and Bambu Studio / Orca / PrusaSlicer project data: filament slots and colours
 * (`Metadata/project_settings.config`), each object's and part's filament
 * (`Metadata/model_settings.config`), colours painted on the surface (`paint_color`,
 * `slic3rpe:mmu_segmentation`) and the sliced plates' time and grams per filament
 * (`Metadata/slice_info.config`). Modifiers, negative parts and support blockers are not part
 * of the printed piece and are left out. The G-code inside a sliced file is never read.
 */

/** What a 3MF says about the piece, for prices, stock and the dashboard. */
export interface ThreeMfInfo {
  /** Bounding box of the printed parts, millimetres (width, depth, height). */
  sizeMm: [number, number, number];
  triangles: number;
  /** One per filament the piece uses, in slot order. */
  colours: {
    /** The slicer's filament number, 1 and up. */
    slot: number;
    /** #RRGGBB. */
    hex: string;
    /** PLA, PETG…: the file's filament type, when it says. */
    type: string | null;
    /** The share of the solid printed in this colour (mm³); painted areas count as a shell. */
    volumeMm3: number;
    /** What the slicer said this filament takes (sliced files only). */
    grams: number | null;
  }[];
  /** The slicer's print time over all plates; null when the file was never sliced. */
  printSeconds: number | null;
}

export interface ThreeMfModel {
  /** Triangles per filament (x, y, z per corner, millimetres, Z-up, as placed on the plate). */
  parts: { slot: number; hex: string; positions: Float32Array }[];
  info: ThreeMfInfo;
}

const LIMITS = {
  maxEntries: 10_000,
  // A model file is read as text: V8 strings stop a little past 500 MB.
  maxEntryBytes: 400 * 1024 * 1024,
};
/** More than any printable model has. */
const MAX_TRIANGLES = 3_000_000;
/** How deep components may nest (a loop in a hostile file stops here). */
const MAX_DEPTH = 8;
/** When a file doesn't say: Bambu's default walls, and a line width of 0.42 mm. */
const DEFAULT_WALLS = 2;
const LINE_WIDTH_MM = 0.42;
const GREY = '#9a9a9a';

type Matrix = readonly number[]; // 12 numbers, 3MF order: m00 m01 m02 m10 … m30 m31 m32
const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

interface MeshObject {
  kind: 'mesh';
  vertices: Float64Array;
  /** v1 v2 v3 per triangle. */
  triangles: Uint32Array;
  /** A triangle's painted filament (0 = the part's own) and the painted share of it. */
  paint: Uint8Array | null;
  paintShare: Float32Array | null;
  /** Base-material colour per triangle, when the file uses them (index into the colours). */
  triangleColour: Int32Array | null;
}

interface ComponentsObject {
  kind: 'components';
  components: { path: string; objectId: string; transform: Matrix }[];
}

type ModelObject = (MeshObject | ComponentsObject) & {
  /** Slicer project data: other parts (modifiers…) are skipped. */
  colour: number | null;
};

/** A 3MF's model and what it says about printing it. Throws on a file it can't read. */
export function readThreeMf(data: Uint8Array): ThreeMfModel {
  const entries = new Map<string, ZipEntry>();
  for (const e of zipEntries(data, LIMITS)) {
    entries.set(normalisePath(e.name), e);
  }
  const rootPath = rootModelPath(entries);
  const settings = projectSettings(entries);
  const parts = modelSettings(entries);
  const sliced = sliceInfo(entries);

  const files = new Map<string, ModelFile>();
  const file = (path: string): ModelFile => {
    let f = files.get(path);
    if (!f) {
      const entry = entries.get(path);
      if (!entry) throw new Error(`The 3MF names a missing file: ${path}`);
      f = parseModelFile(entry.read().toString('latin1'));
      files.set(path, f);
    }
    return f;
  };
  const root = file(rootPath);

  // The filament colours: the slicer's slots, then base-material colours found on the way.
  const slotHex = settings.colours.map(normaliseHex);
  const colourSlot = new Map<string, number>();
  const slotForHex = (hex: string): number => {
    let slot = colourSlot.get(hex);
    if (slot === undefined) {
      const known = slotHex.indexOf(hex);
      slot = known >= 0 ? known + 1 : slotHex.push(hex);
      colourSlot.set(hex, slot);
    }
    return slot;
  };

  const soups = new Map<number, number[]>();
  const volume = new Map<number, number>();
  const painted = new Map<number, number>();
  let triangles = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const walls =
    (Number.isFinite(settings.walls) ? settings.walls : DEFAULT_WALLS) *
    LINE_WIDTH_MM;

  const addMesh = (
    from: ModelFile,
    mesh: MeshObject,
    transform: Matrix,
    slot: number,
  ) => {
    const count = mesh.triangles.length / 3;
    triangles += count;
    if (triangles > MAX_TRIANGLES) {
      throw new Error(`More than ${MAX_TRIANGLES} triangles`);
    }
    const scale = from.unitMm;
    const point = (v: number): [number, number, number] => {
      const x = mesh.vertices[v * 3]! * scale;
      const y = mesh.vertices[v * 3 + 1]! * scale;
      const z = mesh.vertices[v * 3 + 2]! * scale;
      const t = transform;
      return [
        x * t[0]! + y * t[3]! + z * t[6]! + t[9]!,
        x * t[1]! + y * t[4]! + z * t[7]! + t[10]!,
        x * t[2]! + y * t[5]! + z * t[8]! + t[11]!,
      ];
    };
    const corners = new Float64Array(mesh.vertices.length);
    const used = new Uint8Array(mesh.vertices.length / 3);
    for (let i = 0; i < mesh.triangles.length; i++)
      used[mesh.triangles[i]!] = 1;
    for (let v = 0; v < used.length; v++) {
      if (!used[v]) continue;
      const p = point(v);
      corners.set(p, v * 3);
      for (let a = 0; a < 3; a++) {
        if (p[a]! < min[a]!) min[a] = p[a]!;
        if (p[a]! > max[a]!) max[a] = p[a]!;
      }
    }
    let partVolume = 0;
    for (let t = 0; t < count; t++) {
      const [a, b, c] = [
        mesh.triangles[t * 3]!,
        mesh.triangles[t * 3 + 1]!,
        mesh.triangles[t * 3 + 2]!,
      ];
      const ax = corners[a * 3]!,
        ay = corners[a * 3 + 1]!,
        az = corners[a * 3 + 2]!;
      const bx = corners[b * 3]!,
        by = corners[b * 3 + 1]!,
        bz = corners[b * 3 + 2]!;
      const cx = corners[c * 3]!,
        cy = corners[c * 3 + 1]!,
        cz = corners[c * 3 + 2]!;
      partVolume +=
        (ax * (by * cz - bz * cy) -
          ay * (bx * cz - bz * cx) +
          az * (bx * cy - by * cx)) /
        6;
      let own = slot;
      const bm = mesh.triangleColour?.[t] ?? -1;
      if (bm >= 0) own = slotForHex(from.colours[bm] ?? GREY);
      const state = mesh.paint?.[t] ?? 0;
      const drawn = state > 0 ? state : own;
      if (state > 0 && state !== own) {
        const ux = bx - ax,
          uy = by - ay,
          uz = bz - az;
        const vx = cx - ax,
          vy = cy - ay,
          vz = cz - az;
        const area =
          Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) /
          2;
        const share = mesh.paintShare?.[t] ?? 1;
        painted.set(state, (painted.get(state) ?? 0) + area * share * walls);
        painted.set(own, (painted.get(own) ?? 0) - area * share * walls);
      }
      let soup = soups.get(drawn);
      if (!soup) soups.set(drawn, (soup = []));
      soup.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    }
    volume.set(slot, (volume.get(slot) ?? 0) + Math.abs(partVolume));
  };

  const place = (
    from: ModelFile,
    id: string,
    transform: Matrix,
    slot: number,
    objectSettings: ObjectSettings | null,
    depth: number,
  ) => {
    if (depth > MAX_DEPTH) throw new Error('The 3MF nests too deeply');
    const object = from.objects.get(id);
    if (!object) throw new Error(`The 3MF names a missing object: ${id}`);
    const own =
      object.colour !== null
        ? slotForHex(from.colours[object.colour] ?? GREY)
        : slot;
    if (object.kind === 'mesh') {
      addMesh(from, object, transform, own);
      return;
    }
    for (const c of object.components) {
      const part = depth === 0 ? objectSettings?.parts.get(c.objectId) : null;
      if (part && part.subtype !== 'normal_part') continue;
      const next = c.path ? file(c.path) : from;
      place(
        next,
        c.objectId,
        multiply(c.transform, transform),
        part?.extruder ?? own,
        null,
        depth + 1,
      );
    }
  };

  for (const item of root.build) {
    const object = parts.get(item.objectId) ?? null;
    if (object?.subtype && object.subtype !== 'normal_part') continue;
    if (item.printable === false) continue;
    place(
      root,
      item.objectId,
      item.transform,
      object?.extruder ?? 1,
      object,
      0,
    );
  }
  if (triangles === 0) throw new Error('The 3MF has no printable model');

  // Painted areas: a shell of the walls' thickness moves from the part's colour to the paint.
  for (const [slot, delta] of painted) {
    volume.set(slot, Math.max(0, (volume.get(slot) ?? 0) + delta));
  }
  const slots = [...new Set([...soups.keys(), ...sliced.grams.keys()])].sort(
    (a, b) => a - b,
  );
  return {
    parts: [...soups].map(([slot, soup]) => ({
      slot,
      hex: slotHex[slot - 1] ?? GREY,
      positions: Float32Array.from(soup),
    })),
    info: {
      sizeMm: [0, 1, 2].map((a) => round(max[a]! - min[a]!, 2)) as [
        number,
        number,
        number,
      ],
      triangles,
      colours: slots.map((slot) => ({
        slot,
        hex: sliced.hex.get(slot) ?? slotHex[slot - 1] ?? GREY,
        type: sliced.type.get(slot) ?? settings.types[slot - 1] ?? null,
        volumeMm3: round(volume.get(slot) ?? 0, 1),
        grams: sliced.grams.has(slot)
          ? round(sliced.grams.get(slot)!, 2)
          : null,
      })),
      printSeconds: sliced.seconds,
    },
  };
}

interface ModelFile {
  unitMm: number;
  objects: Map<string, ModelObject>;
  build: { objectId: string; transform: Matrix; printable: boolean }[];
  /** Base materials' display colours, by "<group id>:<index>" order of appearance. */
  colours: string[];
}

const UNITS: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

/** One `.model` XML part of the archive, scanned as text (it can be hundreds of MB). */
function parseModelFile(xml: string): ModelFile {
  const modelTag = tagAt(xml, xml.indexOf('<model'));
  const unit = modelTag ? attributes(modelTag)['unit'] : undefined;
  const unitMm = UNITS[unit ?? 'millimeter'];
  if (unitMm === undefined) throw new Error(`Unknown 3MF unit: ${unit}`);

  // Base materials: <basematerials id> <base displaycolor/>…
  const colours: string[] = [];
  const groupStart = new Map<string, number>();
  for (let at = xml.indexOf('<basematerials'); at >= 0;) {
    const end = xml.indexOf('</basematerials>', at);
    const id = attributes(tagAt(xml, at) ?? '')['id'];
    if (id !== undefined) groupStart.set(id, colours.length);
    const block = xml.slice(at, end < 0 ? undefined : end);
    for (const m of block.matchAll(/<base\b[^>]*>/g)) {
      colours.push(normaliseHex(attributes(m[0])['displaycolor'] ?? GREY));
    }
    at = end < 0 ? -1 : xml.indexOf('<basematerials', end);
  }
  const colourIndex = (pid: string | undefined, index: string | undefined) => {
    if (pid === undefined) return null;
    const start = groupStart.get(pid);
    return start === undefined ? null : start + Number(index ?? 0);
  };

  const objects = new Map<string, ModelObject>();
  for (let at = findTag(xml, 'object', 0); at >= 0;) {
    const tag = tagAt(xml, at) ?? '';
    const a = attributes(tag);
    const end = tag.endsWith('/>')
      ? at + tag.length
      : xml.indexOf('</object>', at);
    if (end < 0) throw new Error('The 3MF model is cut short');
    const type = a['type'] ?? 'model';
    if (a['id'] && (type === 'model' || type === 'solidsupport')) {
      const colour = colourIndex(a['pid'], a['pindex']);
      const meshAt = findTag(xml, 'mesh', at);
      if (meshAt >= 0 && meshAt < end) {
        objects.set(a['id'], {
          ...parseMesh(xml, meshAt, end, colourIndex),
          colour,
        });
      } else {
        const components: ComponentsObject['components'] = [];
        for (let c = xml.indexOf('<component ', at); c >= 0 && c < end;) {
          const ct = tagAt(xml, c) ?? '';
          const ca = attributes(ct);
          if (ca['objectid']) {
            components.push({
              path: ca['p:path'] ? normalisePath(ca['p:path']) : '',
              objectId: ca['objectid'],
              transform: matrix(ca['transform']),
            });
          }
          c = xml.indexOf('<component ', c + ct.length);
        }
        objects.set(a['id'], { kind: 'components', components, colour });
      }
    }
    at = findTag(xml, 'object', end);
  }

  const build: ModelFile['build'] = [];
  const buildAt = findTag(xml, 'build', 0);
  for (let at = buildAt < 0 ? -1 : findTag(xml, 'item', buildAt); at >= 0;) {
    const tag = tagAt(xml, at) ?? '';
    const a = attributes(tag);
    if (a['objectid']) {
      build.push({
        objectId: a['objectid'],
        transform: matrix(a['transform']),
        printable: a['printable'] !== '0',
      });
    }
    at = findTag(xml, 'item', at + tag.length);
  }
  return { unitMm, objects, build, colours };
}

function parseMesh(
  xml: string,
  from: number,
  to: number,
  colourIndex: (
    pid: string | undefined,
    index: string | undefined,
  ) => number | null,
): MeshObject {
  const vertices: number[] = [];
  const vEnd = Math.min(to, endOf(xml, '</vertices>', from, to));
  for (let at = findTag(xml, 'vertex', from); at >= 0 && at < vEnd;) {
    const close = xml.indexOf('>', at);
    const tag = xml.slice(at, close + 1);
    vertices.push(num(tag, 'x'), num(tag, 'y'), num(tag, 'z'));
    at = findTag(xml, 'vertex', close);
  }
  const count = vertices.length / 3;
  const tris: number[] = [];
  const paints: number[] = [];
  const shares: number[] = [];
  const colours: number[] = [];
  let anyPaint = false;
  let anyColour = false;
  for (let at = findTag(xml, 'triangle', vEnd); at >= 0 && at < to;) {
    const close = xml.indexOf('>', at);
    const tag = xml.slice(at, close + 1);
    const v1 = num(tag, 'v1');
    const v2 = num(tag, 'v2');
    const v3 = num(tag, 'v3');
    at = findTag(xml, 'triangle', close);
    if (!(
      v1 >= 0 &&
      v2 >= 0 &&
      v3 >= 0 &&
      v1 < count &&
      v2 < count &&
      v3 < count
    )) {
      throw new Error('A triangle names a missing vertex');
    }
    tris.push(v1, v2, v3);
    const code =
      attr(tag, 'paint_color') ?? attr(tag, 'slic3rpe:mmu_segmentation');
    if (code) {
      const [state, share] = paintState(code);
      paints.push(state);
      shares.push(share);
      anyPaint ||= state > 0;
    } else {
      paints.push(0);
      shares.push(0);
    }
    const pid = attr(tag, 'pid');
    const c = pid === undefined ? null : colourIndex(pid, attr(tag, 'p1'));
    colours.push(c ?? -1);
    anyColour ||= c !== null;
    if (tris.length / 3 > MAX_TRIANGLES) {
      throw new Error(`More than ${MAX_TRIANGLES} triangles`);
    }
  }
  return {
    kind: 'mesh',
    vertices: Float64Array.from(vertices),
    triangles: Uint32Array.from(tris),
    paint: anyPaint ? Uint8Array.from(paints) : null,
    paintShare: anyPaint ? Float32Array.from(shares) : null,
    triangleColour: anyColour ? Int32Array.from(colours) : null,
  };
}

/**
 * A painted triangle's filament and how much of it is painted that way. Slicers store the
 * paint as a tree of sub-triangles (hex nibbles, read from the end): each node is either split
 * (its low two bits: sides split) with its children following, or a leaf holding its state.
 * The triangle takes the filament covering most of it; its share counts for the grams.
 */
export function paintState(code: string): [state: number, share: number] {
  const nibbles: number[] = [];
  for (let i = code.length - 1; i >= 0; i--) {
    const n = parseInt(code[i]!, 16);
    if (Number.isNaN(n)) return [0, 0];
    nibbles.push(n);
  }
  let at = 0;
  const areas = new Map<number, number>();
  const visit = (share: number, depth: number): void => {
    if (at >= nibbles.length || depth > 32) return;
    const code = nibbles[at++]!;
    const sides = code & 0b11;
    if (sides === 0) {
      let state = code >> 2;
      if (state === 3) state = (nibbles[at++] ?? 0) + 3;
      areas.set(state, (areas.get(state) ?? 0) + share);
      return;
    }
    // One side split: two halves; two: a quarter and two of 3/8; three: four quarters.
    const children =
      sides === 1
        ? [0.5, 0.5]
        : sides === 2
          ? [0.25, 0.375, 0.375]
          : [0.25, 0.25, 0.25, 0.25];
    for (const c of children) visit(share * c, depth + 1);
  };
  visit(1, 0);
  let best = 0;
  let bestShare = -1;
  let paintedShare = 0;
  for (const [state, share] of areas) {
    if (state > 0) paintedShare += share;
    if (share > bestShare) [best, bestShare] = [state, share];
  }
  return [best, best > 0 ? paintedShare : 0];
}

interface ObjectSettings {
  extruder: number | null;
  subtype: string | null;
  parts: Map<string, { extruder: number | null; subtype: string }>;
}

/** Each object's and part's filament, from the slicer's project data (Bambu, Orca). */
function modelSettings(
  entries: Map<string, ZipEntry>,
): Map<string, ObjectSettings> {
  const result = new Map<string, ObjectSettings>();
  const entry =
    entries.get('Metadata/model_settings.config') ??
    entries.get('Metadata/Slic3r_PE_model.config');
  if (!entry || entry.size > 64 * 1024 * 1024) return result;
  const xml = entry.read().toString('utf8');
  for (const m of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
    const id = attributes(`<o ${m[1]}>`)['id'];
    if (!id) continue;
    const body = m[2]!;
    const parts = new Map<
      string,
      { extruder: number | null; subtype: string }
    >();
    // <part …>…</part>, or <part …/> with nothing inside.
    const partTags = /<(part|volume)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
    for (const p of body.matchAll(partTags)) {
      const pa = attributes(`<p ${p[2]}>`);
      if (!pa['id']) continue;
      const inside = p[3] ?? '';
      const modifier = metadata(inside, 'modifier') === '1';
      parts.set(pa['id'], {
        extruder: positiveInt(metadata(inside, 'extruder')),
        subtype: pa['subtype'] ?? (modifier ? 'modifier_part' : 'normal_part'),
      });
    }
    const own = body.replace(partTags, '');
    result.set(id, {
      extruder: positiveInt(metadata(own, 'extruder')),
      subtype: null,
      parts,
    });
  }
  return result;
}

/** Filament slots, types and wall count from the slicer's settings (Bambu, Orca: JSON). */
function projectSettings(entries: Map<string, ZipEntry>): {
  colours: string[];
  types: string[];
  walls: number;
} {
  const entry = entries.get('Metadata/project_settings.config');
  if (!entry || entry.size > 64 * 1024 * 1024) {
    return { colours: [], types: [], walls: NaN };
  }
  try {
    const json = JSON.parse(entry.read().toString('utf8')) as Record<
      string,
      unknown
    >;
    const list = (key: string) =>
      Array.isArray(json[key])
        ? (json[key] as unknown[]).map((v) => String(v))
        : [];
    return {
      colours: list('filament_colour'),
      types: list('filament_type'),
      walls: Number(json['wall_loops']),
    };
  } catch {
    return { colours: [], types: [], walls: NaN };
  }
}

/** A sliced file's plates: total time, and grams, colour and type per filament slot. */
function sliceInfo(entries: Map<string, ZipEntry>): {
  seconds: number | null;
  grams: Map<number, number>;
  hex: Map<number, string>;
  type: Map<number, string>;
} {
  const grams = new Map<number, number>();
  const hex = new Map<number, string>();
  const type = new Map<number, string>();
  const entry = entries.get('Metadata/slice_info.config');
  if (!entry || entry.size > 16 * 1024 * 1024) {
    return { seconds: null, grams, hex, type };
  }
  const xml = entry.read().toString('utf8');
  let seconds: number | null = null;
  for (const plate of xml.matchAll(/<plate\b[^>]*>([\s\S]*?)<\/plate>/g)) {
    const prediction = Number(metadata(plate[1]!, 'prediction'));
    if (Number.isFinite(prediction) && prediction > 0) {
      seconds = (seconds ?? 0) + prediction;
    }
    for (const f of plate[1]!.matchAll(/<filament\b[^>]*>/g)) {
      const a = attributes(f[0]);
      const slot = positiveInt(a['id']);
      const used = Number(a['used_g']);
      if (slot === null || !Number.isFinite(used) || used <= 0) continue;
      grams.set(slot, (grams.get(slot) ?? 0) + used);
      if (a['color']) hex.set(slot, normaliseHex(a['color']));
      if (a['type']) type.set(slot, a['type']);
    }
  }
  return { seconds, grams, hex, type };
}

function rootModelPath(entries: Map<string, ZipEntry>): string {
  const rels = entries.get('_rels/.rels');
  if (rels && rels.size < 1024 * 1024) {
    const xml = rels.read().toString('utf8');
    for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
      const a = attributes(m[0]);
      if (a['Type']?.endsWith('/3dmodel') && a['Target']) {
        return normalisePath(a['Target']);
      }
    }
  }
  if (entries.has('3D/3dmodel.model')) return '3D/3dmodel.model';
  throw new Error('Not a 3MF file: no 3D model inside');
}

const normalisePath = (p: string) => p.replace(/\\/g, '/').replace(/^\/+/, '');

function normaliseHex(value: string): string {
  const m = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(value.trim());
  return m ? `#${m[1]!.toLowerCase()}` : GREY;
}

/** Where the next `<name …>` tag starts (not `<names>`), or -1. */
function findTag(xml: string, name: string, from: number): number {
  const open = `<${name}`;
  for (
    let at = xml.indexOf(open, from);
    at >= 0;
    at = xml.indexOf(open, at + 1)
  ) {
    const next = xml.charCodeAt(at + open.length);
    // space, tab, newline, carriage return, '/' or '>'
    if (
      next === 32 ||
      next === 9 ||
      next === 10 ||
      next === 13 ||
      next === 47 ||
      next === 62
    ) {
      return at;
    }
  }
  return -1;
}

/** The tag starting at `at` (`<name …>`), or null. */
function tagAt(xml: string, at: number): string | null {
  if (at < 0) return null;
  const close = xml.indexOf('>', at);
  return close < 0 ? null : xml.slice(at, close + 1);
}

function endOf(
  xml: string,
  token: string,
  from: number,
  fallback: number,
): number {
  const at = xml.indexOf(token, from);
  return at < 0 ? fallback : at;
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
    result[m[1]!] = decodeEntities(m[2]!);
  }
  return result;
}

/** One attribute of a short tag, without building them all (vertices and triangles). */
function attr(tag: string, name: string): string | undefined {
  const key = ` ${name}="`;
  const at = tag.indexOf(key);
  if (at < 0) return undefined;
  const end = tag.indexOf('"', at + key.length);
  return end < 0 ? undefined : tag.slice(at + key.length, end);
}

function num(tag: string, name: string): number {
  const v = attr(tag, name);
  const n = v === undefined ? NaN : Number(v);
  if (!Number.isFinite(n)) throw new Error(`A 3MF ${name} is not a number`);
  return n;
}

function metadata(xml: string, key: string): string | undefined {
  const m = new RegExp(`<metadata\\s+key="${key}"\\s+value="([^"]*)"`).exec(
    xml,
  );
  return m ? decodeEntities(m[1]!) : undefined;
}

function positiveInt(value: string | undefined): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 256 ? n : null;
}

function matrix(value: string | undefined): Matrix {
  if (!value) return IDENTITY;
  const n = value.trim().split(/\s+/).map(Number);
  return n.length === 12 && n.every(Number.isFinite) ? n : IDENTITY;
}

/** `first` then `second` (3MF matrices act on row vectors: p · first · second). */
function multiply(first: Matrix, second: Matrix): Matrix {
  const out: number[] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      out.push(
        r < 3
          ? first[r * 3]! * second[c]! +
              first[r * 3 + 1]! * second[3 + c]! +
              first[r * 3 + 2]! * second[6 + c]!
          : first[9]! * second[c]! +
              first[10]! * second[3 + c]! +
              first[11]! * second[6 + c]! +
              second[9 + c]!,
      );
    }
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const round = (n: number, places: number) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};
