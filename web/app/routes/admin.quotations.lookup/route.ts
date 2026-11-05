import {
  PRODUCT_SIZE_GROUP_ID,
  type ProductDetail,
  type QuotationContact,
} from '@forgea/types';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** One of a product's sizes, for a quotation line: its measurements and price. */
export interface QuotationSize {
  id: string;
  label: string;
  x: string;
  y: string;
  z: string;
  unitPrice: string | null;
}

export type QuotationLookup =
  { contact: QuotationContact } | { sizes: QuotationSize[] };

const SIZE = /^([\d.]+) × ([\d.]+) × ([\d.]+) cm$/;

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
  const r = await api.get<ProductDetail>(`/products/${slug}`);
  if (!r.ok) return null;
  const option = r.data.options.find((o) => o.kind === 'SIZE');
  if (!option) return { sizes: [] };
  const sizes = await Promise.all(
    option.choices.map(async (c): Promise<QuotationSize | null> => {
      const m = SIZE.exec(c.label);
      if (!m) return null;
      const price = await api.post<{ unitPrice: string }>(
        `/products/${slug}/price`,
        { options: [{ groupId: PRODUCT_SIZE_GROUP_ID, valueId: c.id }] },
      );
      return {
        id: c.id,
        label: c.label,
        x: m[1]!,
        y: m[2]!,
        z: m[3]!,
        unitPrice: price.ok ? price.data.unitPrice : null,
      };
    }),
  );
  return { sizes: sizes.filter((s) => s !== null) };
}
