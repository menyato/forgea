import type { SizeCm } from './catalog.js';

/**
 * A new size for a product, from one measurement: the other two follow the model's proportions,
 * and grams and hours are suggested from the volume (it grows with the cube of the scale).
 * The owner edits any of them; this only fills the boxes.
 */
export function scaledSize(
  base: { size: SizeCm; grams: string; printHours: string },
  axis: keyof SizeCm,
  cm: number,
): { size: SizeCm; grams: string; printHours: string } {
  const from = Number(base.size[axis]);
  if (!(from > 0) || !(cm > 0)) {
    throw new Error('A size needs measurements above zero');
  }
  const scale = cm / from;
  const cmOf = (v: string) =>
    (Math.round(Number(v) * scale * 10) / 10).toFixed(1);
  const volume = scale ** 3;
  return {
    size: { x: cmOf(base.size.x), y: cmOf(base.size.y), z: cmOf(base.size.z) },
    grams: (Number(base.grams) * volume).toFixed(2),
    printHours: (Number(base.printHours) * volume).toFixed(2),
  };
}
