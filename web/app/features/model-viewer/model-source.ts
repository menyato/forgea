import {
  type ModelVariant,
  modelVariantKey,
} from '@forgea/validation/constants';

/**
 * The storefront URL of a model, and how to read it. No three.js here.
 * With a `variant`, the API's compressed copy (always GLB); without, the uploaded file itself
 * (only where exact measuring matters). A 3MF is never read in the browser: it always shows
 * its `view` copy, in the file's own colours. `paintable`: the model came from an STL, which
 * has no colours of its own, so it takes the chosen one.
 */
export const modelSource = (key: string, variant?: ModelVariant) => {
  const copy = variant ?? (isThreeMf(key) ? 'view' : undefined);
  return {
    src: `/media/${copy ? modelVariantKey(key, copy) : key}`,
    format: copy || key.endsWith('.glb') ? ('glb' as const) : ('stl' as const),
    paintable: key.endsWith('.stl'),
  };
};

/** A Bambu Studio (or other slicer) project: colours, plates and grams of its own. */
export const isThreeMf = (key: string) => key.endsWith('.3mf');
