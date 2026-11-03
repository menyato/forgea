import type { ApiClient } from '~/lib/api-client.server';

/**
 * A personalised piece's print file relayed from the API for the slicer (one colour's STL, or
 * every colour as a 3MF). The API checks who may have it (orders.view) and makes it from the
 * order's design.
 */
export async function relayPrintFile(
  api: ApiClient,
  path: string,
): Promise<Response> {
  const upstream = await api.file(path);
  if (!upstream.ok || !upstream.body)
    throw new Response('No such print file', {
      status: upstream.status === 403 ? 403 : 404,
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
  // Made fresh for whoever may have it: never kept by a shared cache, never re-compressed.
  headers.set('cache-control', 'private, no-store, no-transform');
  return new Response(upstream.body, { headers });
}
