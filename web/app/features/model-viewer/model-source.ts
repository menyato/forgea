import {
  type ModelVariant,
  modelVariantKey,
} from '@forgea/validation/constants';

/**
 * The storefront URL of a model, and how to read it. No three.js here.
 * With a `variant`, the API's compressed copy (always GLB); without, the uploaded file itself
 * (only where exact measuring matters). `paintable`: the model came from an STL, which has no
 * colours of its own, so it takes the chosen one.
 */
export const modelSource = (key: string, variant?: ModelVariant) => ({
  src: `/media/${variant ? modelVariantKey(key, variant) : key}`,
  format: variant || key.endsWith('.glb') ? ('glb' as const) : ('stl' as const),
  paintable: key.endsWith('.stl'),
});
