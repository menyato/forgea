import { UploadPurpose } from '../generated/prisma/enums.js';

const MB = 1024 * 1024;

export interface UploadPolicy {
  maxBytes: number;
  /** Allowed sniffed MIME types → file extension used for the stored object. */
  types: ReadonlyMap<string, string>;
}

const rasterImages = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
]);
const models = new Map([
  ['model/gltf-binary', 'glb'],
  ['model/stl', 'stl'],
]);

/**
 * What each upload may be. SVG is deliberately absent: it can carry scripts.
 * Limits are also enforced earlier by multer, so oversized bodies are never buffered whole.
 */
export const UPLOAD_POLICIES: Readonly<Record<UploadPurpose, UploadPolicy>> = {
  [UploadPurpose.LEAD_REFERENCE]: { maxBytes: 10 * MB, types: rasterImages },
  [UploadPurpose.PRODUCT_IMAGE]: { maxBytes: 15 * MB, types: rasterImages },
  [UploadPurpose.PRODUCT_MODEL]: { maxBytes: 100 * MB, types: models },
  // The ceiling; the owner's lower limit (store settings, 50 MB to start) is checked as well.
  [UploadPurpose.CUSTOM_REQUEST_FILE]: {
    maxBytes: 100 * MB,
    types: new Map([...models, ...rasterImages]),
  },
};
