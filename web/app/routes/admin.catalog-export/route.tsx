import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

// A resource route inside the dashboard layout, whose middleware refuses non-staff.

/** Streams the API's catalog export to the browser as a download (admins only, by the API). */
export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  // "?only=text": just the personalised-text products and what they use.
  const only = url.searchParams.get('only') === 'text' ? '?only=text' : '';
  const upstream = await api.file(`/catalog-transfer/export${only}`);
  if (!upstream.ok) {
    return new Response(await upstream.text(), { status: upstream.status });
  }
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  const disposition = upstream.headers.get('content-disposition');
  if (disposition) headers.set('Content-Disposition', disposition);
  return new Response(upstream.body, { headers });
}
