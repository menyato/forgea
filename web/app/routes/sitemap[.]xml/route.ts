import type { Page, ProductListItem } from '@forgea/types';
import { PAGE_SIZE_MAX } from '@forgea/validation/constants';
import { sitemapXml } from '~/features/seo/seo';
import { serverEnv } from '~/lib/env.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** At most this many pages of products (a sitemap holds 50,000 addresses). */
const MAX_PAGES = 100;

/** /sitemap.xml — the public pages and every product in the shop, for search engines. */
export async function loader({ context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const slugs: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE_MAX) });
    if (cursor) query.set('cursor', cursor);
    const r = await api.get<Page<ProductListItem>>(`/products?${query}`);
    // Better no sitemap for a moment than one that drops products from search.
    if (!r.ok) throw new Response('Sitemap unavailable', { status: 503 });
    slugs.push(...r.data.items.map((p) => p.slug));
    if (!r.data.hasMore || !r.data.nextCursor) break;
    cursor = r.data.nextCursor;
  }
  return new Response(sitemapXml(serverEnv().PUBLIC_WEB_URL, slugs), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
