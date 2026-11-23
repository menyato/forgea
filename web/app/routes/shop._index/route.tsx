import type {
  CategoryView,
  CurrencyQuote,
  Page,
  ProductListItem,
} from '@forgea/types';
import { Form, Link, useSearchParams } from 'react-router';
import { PAGE_WIDTH } from '~/components/layout/page-width';
import { Field } from '~/components/ui/field';
import { buttonClass } from '~/components/ui/button';
import { ProductCard } from '~/features/catalog/product-card';
import { seoMeta, siteOrigin } from '~/features/seo/seo';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export function meta({ location, matches }: Route.MetaArgs) {
  // A category is its own page for search engines; searches and later pages of a list are not.
  const category = new URLSearchParams(location.search).get('category');
  return seoMeta({
    origin: siteOrigin(matches),
    path: category
      ? `/shop?${new URLSearchParams({ category }).toString()}`
      : '/shop',
    title: 'Shop — Forgea',
    description: '3D-printed products, designed and made in Lebanon.',
  });
}

const PAGE_SIZE = 24;

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  for (const key of ['q', 'cursor', 'category'] as const) {
    const value = url.searchParams.get(key);
    if (value) query.set(key, value);
  }
  const [products, currencies, categories] = await Promise.all([
    api.get<Page<ProductListItem>>(`/products?${query}`),
    api.get<CurrencyQuote[]>('/currencies'),
    api.get<CategoryView[]>('/categories'),
  ]);
  if (!products.ok)
    throw new Response(products.message, { status: products.status });
  return {
    products: products.data,
    currencies: currencies.ok ? currencies.data : [],
    categories: categories.ok ? categories.data : [],
  };
}

export default function Shop({ loaderData }: Route.ComponentProps) {
  const { products, currencies, categories } = loaderData;
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('category');
  const filterTo = (slug: string | null) => {
    const next = new URLSearchParams(params);
    next.delete('cursor');
    if (slug) next.set('category', slug);
    else next.delete('category');
    return `?${next}`;
  };
  const lbp = currencies.find((c) => c.code === 'LBP');
  const nextParams = new URLSearchParams(params);
  if (products.nextCursor) nextParams.set('cursor', products.nextCursor);

  return (
    <main className={`${PAGE_WIDTH} grid gap-8 py-10`}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl font-extrabold tracking-tight">
            Shop
          </h1>
          <p className="text-text-muted">
            Printed to order at Forgea Lab. Prices in USD, with the Lebanese
            pound at today's rate.
          </p>
        </div>
        <Form method="get" role="search" className="flex items-end gap-2">
          {category && <input type="hidden" name="category" value={category} />}
          <Field
            label="Search products"
            name="q"
            type="search"
            defaultValue={q}
          />
          <button type="submit" className={buttonClass('secondary')}>
            Search
          </button>
        </Form>
      </header>

      {categories.length > 0 && (
        // One swipeable row on phones, so a long list never pushes the products down.
        <nav
          aria-label="Categories"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
        >
          {[{ slug: null, name: 'Everything' }, ...categories].map((c) => (
            <Link
              key={c.slug ?? 'all'}
              to={filterTo(c.slug)}
              aria-current={category === c.slug ? 'page' : undefined}
              className={`shrink-0 rounded-pill border px-4 py-1.5 text-sm whitespace-nowrap ${
                category === c.slug
                  ? 'border-accent bg-accent text-on-accent'
                  : 'border-border text-text-muted hover:text-text'
              }`}
            >
              {c.name}
            </Link>
          ))}
        </nav>
      )}

      {products.items.length === 0 ? (
        <p className="text-text-muted">
          {q
            ? `Nothing matches "${q}".`
            : 'No products yet — check back soon, or '}
          {!q && (
            <Link to="/" className="underline underline-offset-4">
              tell us what you need
            </Link>
          )}
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-x-6 gap-y-10">
          {products.items.map((p) => (
            <li key={p.id}>
              <ProductCard product={p} lbp={lbp} />
            </li>
          ))}
        </ul>
      )}

      <nav aria-label="Pages" className="flex gap-4">
        {params.has('cursor') && (
          <Link to={filterTo(category)} className={buttonClass('quiet')}>
            First page
          </Link>
        )}
        {products.hasMore && (
          <Link to={`?${nextParams}`} className={buttonClass('secondary')}>
            Next page
          </Link>
        )}
      </nav>
    </main>
  );
}
