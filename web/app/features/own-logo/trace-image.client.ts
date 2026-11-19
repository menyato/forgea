import { inkMask, traceSvg } from '@forgea/text3d/trace';

/** Pixels across the longer side the picture is traced at: detail enough for a print. */
const TRACE_MAX_SIDE = 600;

/**
 * A logo picture (PNG, JPEG, WebP) traced in the browser into an SVG drawing: drawn small
 * enough to trace quickly, its logo pixels told from the background, their outlines followed.
 * Null when there is no logo to find (a blank or a photo-like picture).
 */
export async function traceImage(file: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const k = Math.min(
      1,
      TRACE_MAX_SIDE / Math.max(bitmap.width, bitmap.height),
    );
    const w = Math.max(8, Math.round(bitmap.width * k));
    const h = Math.max(8, Math.round(bitmap.height * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const mask = inkMask(data, w, h);
    // A logo covers some of the picture, not (nearly) all of it.
    const ink = mask.reduce((n, v) => n + v, 0);
    if (ink < w * h * 0.002 || ink > w * h * 0.95) return null;
    return traceSvg(mask, w, h);
  } finally {
    bitmap.close();
  }
}
