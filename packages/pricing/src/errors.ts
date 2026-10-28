/** Invalid pricing input or settings. The message names the offending field. */
export class PricingError extends Error {
  override readonly name = 'PricingError';
}
