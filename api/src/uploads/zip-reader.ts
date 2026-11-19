import { inflateRawSync } from 'node:zlib';

/** One file inside a zip archive, read on demand. */
export interface ZipEntry {
  name: string;
  /** Size once unpacked, as the archive declares it (checked again while unpacking). */
  size: number;
  /** Unpacks it, refusing more than `maxBytes` (the archive's own limit by default). */
  read(maxBytes?: number): Buffer;
}

/** Limits that keep a hostile archive (a zip bomb, millions of entries) cheap to refuse. */
export interface ZipLimits {
  maxEntries: number;
  /** The most one entry may unpack to. */
  maxEntryBytes: number;
  /** The most all the entries read from one archive may unpack to, together. */
  maxTotalBytes: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/**
 * The entries of a zip archive (3MF files are zips), from its central directory. Nothing is
 * unpacked until `read()` is called, and only stored or deflated entries are accepted; an
 * entry may never unpack past `maxEntryBytes` whatever its header claims. Nothing is written
 * to disk and names are never used as paths.
 */
export function zipEntries(data: Uint8Array, limits: ZipLimits): ZipEntry[] {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const end = findEndOfCentralDirectory(buf);
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  if (count > limits.maxEntries) throw new Error('Too many files in the 3MF');
  const entries: ZipEntry[] = [];
  // What this archive has unpacked so far: a few bombs inside one file stop here too.
  let unpacked = 0;
  const counted = (out: Buffer) => {
    unpacked += out.byteLength;
    if (unpacked > limits.maxTotalBytes)
      throw new Error('The 3MF unpacks to too much data');
    return out;
  };
  for (let i = 0; i < count; i++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== CENTRAL) {
      throw new Error('Not a readable 3MF (zip) file');
    }
    const method = buf.readUInt16LE(at + 10);
    const compressed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const localAt = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (
      compressed === 0xffffffff ||
      size === 0xffffffff ||
      localAt === 0xffffffff
    ) {
      throw new Error('3MF files over 4 GB are not accepted');
    }
    entries.push({
      name,
      size,
      read: (maxBytes = limits.maxEntryBytes) => {
        if (size > maxBytes) throw new Error(`${name} is too large to read`);
        if (unpacked + size > limits.maxTotalBytes)
          throw new Error('The 3MF unpacks to too much data');
        if (localAt + 30 > buf.length || buf.readUInt32LE(localAt) !== LOCAL) {
          throw new Error('Not a readable 3MF (zip) file');
        }
        const start =
          localAt +
          30 +
          buf.readUInt16LE(localAt + 26) +
          buf.readUInt16LE(localAt + 28);
        if (start + compressed > buf.length) {
          throw new Error('The 3MF file is cut short');
        }
        const raw = buf.subarray(start, start + compressed);
        if (method === 0) return counted(Buffer.from(raw));
        if (method !== 8)
          throw new Error(`${name} uses an unknown compression`);
        // Stops at the limit even if the header lied about the size.
        return counted(
          inflateRawSync(raw, { maxOutputLength: Math.max(maxBytes, 1) }),
        );
      },
    });
  }
  return entries;
}

function findEndOfCentralDirectory(buf: Buffer): number {
  // The record is 22 bytes plus a comment of up to 64 KB, at the very end.
  const stop = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= stop; i--) {
    if (buf.readUInt32LE(i) === EOCD) return i;
  }
  throw new Error('Not a readable 3MF (zip) file');
}
