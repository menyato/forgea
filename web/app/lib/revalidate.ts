import type { ShouldRevalidateFunctionArgs } from 'react-router';

/**
 * Form posts that only ask the API something, or add a file nothing on the page lists yet: a
 * price preview, a file read, an upload. They change no loader's data, so no loader runs again
 * after them (each would cost its API calls for nothing, and a quick edit could meet the rate
 * limit).
 */
const ASKS = new Set([
  'preview',
  'model-info',
  'print-files',
  'print-file',
  'upload-model',
  'upload-image',
]);

/**
 * A route's `shouldRevalidate`: the default, except after a post that changes nothing, sent
 * from a page that is staying where it is. While the page is moving somewhere else (a save
 * that opens the new record), the loaders must run: the router finishes that move with them.
 */
export function unlessAsking({
  formData,
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs): boolean {
  const intent = formData?.get('intent');
  const staying =
    currentUrl.pathname === nextUrl.pathname &&
    currentUrl.search === nextUrl.search;
  if (staying && typeof intent === 'string' && ASKS.has(intent)) return false;
  return defaultShouldRevalidate;
}
