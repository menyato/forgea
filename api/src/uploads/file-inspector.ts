import { Injectable } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import type { UploadPolicy } from './upload-policies.js';

export type Inspection =
  | { ok: true; mimeType: string; extension: string }
  | { ok: false; reason: string };

/**
 * Decides what a file really is from its bytes (magic numbers), never from its name or the
 * client's Content-Type, and checks it against the upload policy.
 */
@Injectable()
export class FileInspector {
  async inspect(data: Uint8Array, policy: UploadPolicy): Promise<Inspection> {
    if (data.byteLength === 0)
      return { ok: false, reason: 'The file is empty' };
    if (data.byteLength > policy.maxBytes) {
      return {
        ok: false,
        reason: `The file is larger than ${Math.round(policy.maxBytes / 1048576)} MB`,
      };
    }
    const mimeType =
      (await fileTypeFromBuffer(data))?.mime ??
      (isStl(data) ? 'model/stl' : undefined);
    const extension = mimeType ? policy.types.get(mimeType) : undefined;
    if (!mimeType || !extension) {
      return { ok: false, reason: 'This file type is not accepted' };
    }
    return { ok: true, mimeType, extension };
  }
}

/** STL has no magic number: check the binary layout, or the ASCII keywords. */
export function isStl(data: Uint8Array): boolean {
  if (data.byteLength >= 84) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const triangles = view.getUint32(80, true);
    if (triangles > 0 && data.byteLength === 84 + triangles * 50) return true;
  }
  const head = new TextDecoder().decode(data.subarray(0, 512)).trimStart();
  return head.startsWith('solid') && /\bfacet normal\b/.test(head);
}
