import type { TextSettings } from '@forgea/text3d/design';
import type { ProductTextOffer } from '@forgea/types';

/** The product's settings at the size chosen (the widest piece grows with it), as the API does. */
export const settingsOf = (
  offer: ProductTextOffer,
  heightMm: string | undefined,
): TextSettings => {
  const base = Number(offer.letterHeightMm);
  const h = heightMm === undefined ? base : Number(heightMm);
  return {
    style: offer.style,
    maxChars: offer.maxChars,
    letterHeightMm: h,
    letterDepthMm: Number(offer.letterDepthMm),
    baseDepthMm: Number(offer.baseDepthMm),
    maxWidthMm: (Number(offer.maxWidthMm) * h) / base,
    ...(offer.decor ? { decor: offer.decor } : {}),
  };
};
