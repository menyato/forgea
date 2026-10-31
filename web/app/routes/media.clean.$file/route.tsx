import { isMediaKey } from '@forgea/validation/constants';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/**
 * Product models and photos, relayed from the API (browsers never call it). Same URL shape
 * as the object key, so a key from the API maps straight to /media/<key>.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const key = `clean/${params.file}`;
  if (!isMediaKey(key)) throw new Response('Not found', { status: 404 });
  const api = context.get(apiContext);
  const upstream = await api.file(`/media/${key}`);
  // Too many at once: say so (with when to retry), rather than "not found", which would
  // make the page show the model as missing.
  if (upstream.status === 429) {
    throw new Response('Too many requests', {
      status: 429,
      headers: { 'retry-after': upstream.headers.get('retry-after') ?? '5' },
    });
  }
  if (!upstream.ok || !upstream.body)
    throw new Response('Not found', { status: 404 });
  // Session cookies the API set are added by apiMiddleware.
  const headers = new Headers();
  for (const name of ['content-type', 'content-length', 'cache-control']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Models and photos come already compressed: re-compressing megabytes on every request costs
  // the server CPU for next to nothing, and would drop the length the browser shows progress by.
  const cache = headers.get('cache-control');
  headers.set(
    'cache-control',
    cache ? `${cache}, no-transform` : 'no-transform',
  );
  headers.set('x-content-type-options', 'nosniff');
  return new Response(upstream.body, { headers });
}
