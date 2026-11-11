import type { QuotableSize, QuotationContact } from '@forgea/types';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** One of a product's sizes, for a quotation line: its measurements and price. */
export type QuotationSize = QuotableSize;

export type QuotationLookup =
  { contact: QuotationContact } | { sizes: QuotationSize[] };

/**
 * For the quotation editor, while it is filled in: `?email=` what the studio knows about that
 * customer; `?product=<slug>` the product's own sizes, each with its price.
 */
export async function loader({
  url,
  context,
}: Route.LoaderArgs): Promise<QuotationLookup | null> {
  const api = context.get(apiContext);
  const email = url.searchParams.get('email');
  if (email) {
    const r = await api.get<QuotationContact>(
      `/quotations/contact?email=${encodeURIComponent(email)}`,
    );
    return r.ok ? { contact: r.data } : null;
  }
  const slug = url.searchParams.get('product');
  if (!slug || !/^[a-z0-9-]{1,120}$/.test(slug)) return null;
  // The studio's own list: a product not launched in the shop can be quoted too.
  const r = await api.get<QuotableSize[]>(`/products/quotable/${slug}/sizes`);
  return r.ok ? { sizes: r.data } : null;
}
