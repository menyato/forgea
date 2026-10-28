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
  if (!upstream.ok || !upstream.body)
    throw new Response('Not found', { status: 404 });
  // Session cookies the API set are added by apiMiddleware.
  const headers = new Headers();
  for (const name of ['content-type', 'content-length', 'cache-control']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('x-content-type-options', 'nosniff');
  return new Response(upstream.body, { headers });
}
