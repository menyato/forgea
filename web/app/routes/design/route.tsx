import type {
  CategoryView,
  CurrencyQuote,
  Page,
  ProductListItem,
} from '@forgea/types';
import { Link } from 'react-router';
import { PAGE_WIDTH } from '~/components/layout/page-width';
import { buttonClass } from '~/components/ui/button';
import { ProductCard } from '~/features/catalog/product-card';
import { seoMeta, siteOrigin } from '~/features/seo/seo';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export function meta({ matches }: Route.MetaArgs) {
  return seoMeta({
    origin: siteOrigin(matches),
    path: '/design',
    title: 'Design yours — Forgea',
    description:
      'Turn your logo into a 3D-printed piece, add your name, or put them on one of our designs.',
  });
}

/**
 * Design yours: start from the customer's own logo (a keychain or tag made from it, with or
 * without their name), or put their name or logo on one of the studio's pieces. Each piece
 * is designed in 3D on its own page and priced by the API.
 */
export async function loader({ context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const [fromLogo, yours, currencies, categories] = await Promise.all([
    api.get<Page<ProductListItem>>('/products?design=logo&limit=24'),
    api.get<Page<ProductListItem>>('/products?design=yours&limit=48'),
    api.get<CurrencyQuote[]>('/currencies'),
    api.get<CategoryView[]>('/categories'),
  ]);
  if (!yours.ok) throw new Response(yours.message, { status: yours.status });
  const logoIds = new Set(
    fromLogo.ok ? fromLogo.data.items.map((p) => p.id) : [],
  );
  // Everything else customers make theirs (the logo pieces are listed first, once), shelved by
  // the shop's categories in their order, each under its name and the owner's description.
  const rest = yours.data.items.filter((p) => !logoIds.has(p.id));
  const order = (categories.ok ? categories.data : []).filter((c) => c.active);
  const shelves = order
    .map((c) => ({
      slug: c.slug,
      name: c.name,
      description: c.description,
      products: rest.filter((p) => p.category?.slug === c.slug),
    }))
    .filter((s) => s.products.length > 0);
  const shelved = new Set(shelves.flatMap((s) => s.products.map((p) => p.id)));
  const others = rest.filter((p) => !shelved.has(p.id));
  if (others.length)
    shelves.push({
      slug: 'more',
      name: 'More to make yours',
      description: null,
      products: others,
    });
  return {
    fromLogo: fromLogo.ok ? fromLogo.data.items : [],
    shelves,
    lbp: (currencies.ok ? currencies.data : []).find((c) => c.code === 'LBP'),
  };
}

export default function Design({ loaderData }: Route.ComponentProps) {
  const { fromLogo, shelves, lbp } = loaderData;
  return (
    <main className={`${PAGE_WIDTH} grid gap-12 py-10`}>
      <header className="grid max-w-2xl gap-3">
        <h1 className="font-display text-5xl font-extrabold tracking-tight">
          Design yours
        </h1>
        <p className="text-text-muted">
          Drop your logo (a PNG, JPEG or SVG) and see it in 3D, raised on its
          own piece or beside your name. Or put your name or your logo on one of
          our designs. Every piece is printed to order, in the colours you
          choose.
        </p>
      </header>

      {fromLogo.length > 0 && (
        <section aria-labelledby="from-logo" className="grid gap-5">
          <div className="grid gap-1">
            <h2
              id="from-logo"
              className="font-display text-2xl font-bold tracking-tight"
            >
              Start from your logo
            </h2>
            <p className="text-sm text-text-muted">
              Your logo traced and raised in 3D: alone, or with your name, on
              the shape you pick.
            </p>
          </div>
          <Cards products={fromLogo} lbp={lbp} />
        </section>
      )}

      {shelves.map((shelf, k) => (
        <section
          key={shelf.slug}
          aria-labelledby={`shelf-${shelf.slug}`}
          className="grid gap-5 border-t border-border pt-10"
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="grid max-w-2xl gap-1">
              <p className="text-xs font-semibold tracking-[0.2em] text-accent uppercase">
                {String(k + 1).padStart(2, '0')} · Make it yours
              </p>
              <h2
                id={`shelf-${shelf.slug}`}
                className="font-display text-3xl font-extrabold tracking-tight"
              >
                {shelf.name}
              </h2>
              {shelf.description && (
                <p className="text-text-muted">{shelf.description}</p>
              )}
            </div>
            {shelf.slug !== 'more' && (
              <Link
                to={`/shop?category=${shelf.slug}`}
                className={buttonClass('quiet')}
              >
                All of {shelf.name.toLowerCase()}
              </Link>
            )}
          </div>
          <Cards products={shelf.products} lbp={lbp} />
        </section>
      ))}

      <p className="text-sm text-text-muted">
        Something else in mind?{' '}
        <Link to="/custom" className={buttonClass('quiet')}>
          Ask for a custom piece
        </Link>
      </p>
    </main>
  );
}

function Cards({
  products,
  lbp,
}: {
  products: ProductListItem[];
  lbp: CurrencyQuote | undefined;
}) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-x-6 gap-y-10">
      {products.map((p) => (
        <li key={p.id}>
          <ProductCard product={p} lbp={lbp} />
        </li>
      ))}
    </ul>
  );
}
