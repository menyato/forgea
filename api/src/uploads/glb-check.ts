/**
 * Checks a GLB's table of contents (its JSON chunk) without reading any geometry, so a file
 * that would be dangerous to open is refused before anything opens it:
 * - every buffer and image must be inside the file: a URI would make browsers (the staff's,
 *   when they preview a customer's file) fetch other sites, or our own with their cookies;
 * - the sizes it declares must be plausible for its length: a 420-byte file can otherwise
 *   claim gigabytes of compressed geometry and make the server allocate them.
 * Returns the reason it is refused, or null.
 */
export function glbProblem(data: Uint8Array): string | null {
  const json = glbJson(data);
  if (!json) return 'This GLB file is damaged';

  // A proper GLB keeps buffers and images in its binary chunk; any URI (another site, a path
  // on ours, even a data: URI) is refused.
  if (
    [...list(json['buffers']), ...list(json['images'])].some(
      (item) => 'uri' in item,
    )
  ) {
    return 'GLB files must contain everything (no links to other files)';
  }

  // What reading it would allocate: every buffer view, decompressed size where compressed.
  let declared = 0;
  for (const view of list(json['bufferViews'])) {
    const meshopt = record(
      record(view['extensions'])?.['EXT_meshopt_compression'],
    );
    declared += meshopt
      ? number(meshopt['count']) * number(meshopt['byteStride'])
      : number(view['byteLength']);
  }
  const limit = Math.min(
    MAX_DECLARED_BYTES,
    Math.max(MIN_ALLOWANCE, data.byteLength * MAX_EXPANSION),
  );
  return declared > limit
    ? 'This GLB file declares more data than it can hold'
    : null;
}

/** Geometry may decompress to at most this many times the file's size (meshopt: ~10×). */
const MAX_EXPANSION = 64;
/** Small files may always declare this much. */
const MIN_ALLOWANCE = 16 * 1024 * 1024;
/** Never more than this, whatever the file's size. */
const MAX_DECLARED_BYTES = 1024 * 1024 * 1024;

const GLB_MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a; // "JSON"

function glbJson(data: Uint8Array): Record<string, unknown> | null {
  if (data.byteLength < 20) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2)
    return null;
  if (view.getUint32(8, true) !== data.byteLength) return null;
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK || 20 + length > data.byteLength)
    return null;
  try {
    return record(
      JSON.parse(new TextDecoder().decode(data.subarray(20, 20 + length))),
    );
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(record).filter((v) => v !== null)
    : [];
}

/** A declared count or size; anything that isn't a sane whole number counts as huge. */
function number(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : Number.MAX_SAFE_INTEGER;
}
