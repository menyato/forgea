import type { CurrencyQuote, Page, ProductListItem } from '@forgea/types';
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
  const [fromLogo, yours, currencies] = await Promise.all([
    api.get<Page<ProductListItem>>('/products?design=logo&limit=24'),
    api.get<Page<ProductListItem>>('/products?design=yours&limit=48'),
    api.get<CurrencyQuote[]>('/currencies'),
  ]);
  if (!yours.ok) throw new Response(yours.message, { status: yours.status });
  const logoIds = new Set(
    fromLogo.ok ? fromLogo.data.items.map((p) => p.id) : [],
  );
  return {
    fromLogo: fromLogo.ok ? fromLogo.data.items : [],
    // Everything else customers make theirs (the logo pieces are listed first, once).
    yours: yours.data.items.filter((p) => !logoIds.has(p.id)),
    lbp: (currencies.ok ? currencies.data : []).find((c) => c.code === 'LBP'),
  };
}

export default function Design({ loaderData }: Route.ComponentProps) {
  const { fromLogo, yours, lbp } = loaderData;
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

      {yours.length > 0 && (
        <section aria-labelledby="add-yours" className="grid gap-5">
          <div className="grid gap-1">
            <h2
              id="add-yours"
              className="font-display text-2xl font-bold tracking-tight"
            >
              Add your name or logo to a piece
            </h2>
            <p className="text-sm text-text-muted">
              Names, initials and pieces with a place for your text or your
              logo.
            </p>
          </div>
          <Cards products={yours} lbp={lbp} />
        </section>
      )}

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
