import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** A backup file, relayed from the API (admins only, checked there), to keep on a PC. */
export async function loader({ params, context }: Route.LoaderArgs) {
  const upstream = await context
    .get(apiContext)
    .file(`/backups/${encodeURIComponent(params.file)}/download`);
  if (!upstream.ok || !upstream.body)
    throw new Response('No such backup', {
      status: upstream.status === 403 ? 403 : 404,
      headers: { 'cache-control': 'no-store' },
    });
  const headers = new Headers({ 'x-content-type-options': 'nosniff' });
  for (const name of [
    'content-type',
    'content-length',
    'content-disposition',
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Never kept by any cache, never re-compressed (it is encrypted: it wouldn't shrink).
  headers.set('cache-control', 'private, no-store, no-transform');
  return new Response(upstream.body, { headers });
}
