import type { OrderSettings } from '@forgea/pricing';
import type {
  CurrencyQuote,
  HomePlate,
  Page,
  ProductListItem,
} from '@forgea/types';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { PAGE_WIDTH } from '~/components/layout/page-width';
import { buttonClass } from '~/components/ui/button';
import { ProductCard } from '~/features/catalog/product-card';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';
import { BuildPlate } from '~/features/build-plate/build-plate';
import { modelSource } from '~/features/model-viewer/model-source';
import type { PlateItem } from '~/features/build-plate/build-plate-scene.client';

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    // The bed's model files start downloading with the page, alongside three.js rather than
    // after it, so the models are ready when the scene is and printing starts at once.
    ...(loaderData?.plate ?? []).map((p) => ({
      tagName: 'link' as const,
      rel: 'preload',
      as: 'fetch',
      crossOrigin: 'anonymous' as const,
      href: modelSource(p.modelKey, 'lite').src,
    })),
    { title: 'Forgea — 3D printing, design and customization' },
    {
      name: 'description',
      content:
        'Custom 3D printing, product design and electronics, made in Lebanon.',
    },
  ];
}

export async function loader({ context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const [products, plate, currencies, settings] = await Promise.all([
    api.get<Page<ProductListItem>>('/products?limit=8'),
    api.get<HomePlate>('/products/plate'),
    api.get<CurrencyQuote[]>('/currencies'),
    api.get<OrderSettings>('/pricing/order-settings'),
  ]);
  return {
    products: products.ok ? products.data.items : [],
    // Chosen in the dashboard (Home page); the first stands in the centre.
    plate: (plate.ok ? plate.data.products : []).flatMap((p): PlateItem[] =>
      p.modelKey
        ? [
            {
              slug: p.slug,
              name: p.name,
              modelKey: p.modelKey,
              color: p.previewColor ?? '#9a9ea3',
            },
          ]
        : [],
    ),
    lbp: currencies.ok
      ? (currencies.data.find((c) => c.code === 'LBP') ?? null)
      : null,
    depositPercent: settings.ok ? settings.data.depositPercent : null,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { products, plate, lbp, depositPercent } = loaderData;
  const navigate = useNavigate();
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <main>
      <section
        className={`${PAGE_WIDTH} grid items-center gap-x-10 gap-y-6 pt-8 pb-12 lg:min-h-[calc(100dvh-4.5rem)] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:py-6`}
      >
        <div className="grid content-center gap-6 lg:pb-16">
          <h1 className="max-w-[14ch] font-display text-[clamp(2.75rem,6.5vw,6rem)] leading-[0.92] font-extrabold tracking-tight text-balance">
            Designed and printed, layer by layer.
          </h1>
          <p className="max-w-[46ch] text-lg text-text-muted">
            Pick something from the shop and choose its colour and size, or send
            us your idea. We print it in our studio in Lebanon and deliver it to
            your door.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/shop"
              className={buttonClass('primary', 'px-6 py-3 text-base')}
            >
              Browse the shop
            </Link>
            <Link
              to="/custom"
              className={buttonClass('secondary', 'px-6 py-3 text-base')}
            >
              Send us your idea
            </Link>
          </div>
        </div>

        <figure className="grid gap-3">
          <div className="-mx-4 aspect-square sm:mx-0 sm:aspect-[4/3] lg:aspect-auto lg:h-[min(72dvh,46rem)]">
            <BuildPlate
              items={plate}
              hovered={hovered}
              onHover={setHovered}
              onOpen={(slug) => void navigate(`/products/${slug}`)}
            />
          </div>
          {plate.length > 0 && (
            <figcaption className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-text-muted">
              <span>On the plate:</span>
              {plate.map((p) => (
                <Link
                  key={p.slug}
                  to={`/products/${p.slug}`}
                  onPointerEnter={() => setHovered(p.slug)}
                  onPointerLeave={() => setHovered(null)}
                  onFocus={() => setHovered(p.slug)}
                  onBlur={() => setHovered(null)}
                  className={`underline-offset-4 hover:underline ${hovered === p.slug ? 'text-text underline' : ''}`}
                >
                  {p.name}
                </Link>
              ))}
              <span className="hidden sm:inline">
                Drag the plate to turn it.
              </span>
            </figcaption>
          )}
        </figure>
      </section>

      <section
        aria-labelledby="how-heading"
        className="border-y border-border bg-surface"
      >
        <div className={`${PAGE_WIDTH} grid gap-8 py-14`}>
          <h2
            id="how-heading"
            className="font-display text-3xl font-bold tracking-tight"
          >
            How ordering works
          </h2>
          <ol className="grid gap-8 sm:grid-cols-2 xl:grid-cols-4">
            <Step n={1} title="Choose">
              Pick a product, its colour and size. The price updates as you
              choose.
            </Step>
            <Step n={2} title="Order">
              Sign in and leave a phone number. Pay cash on delivery or by money
              transfer to our number.
            </Step>
            <Step n={3} title="We print it">
              Ready-made designs start right away. Made-to-order pieces start
              once the{depositPercent ? ` ${Number(depositPercent)}%` : ''}{' '}
              deposit arrives.
            </Step>
            <Step n={4} title="Delivered">
              Follow every step in My orders, or ask us on WhatsApp at any time.
            </Step>
          </ol>
        </div>
      </section>

      {products.length > 0 && (
        <section
          aria-labelledby="new-heading"
          className={`${PAGE_WIDTH} grid gap-8 py-14`}
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2
              id="new-heading"
              className="font-display text-3xl font-bold tracking-tight"
            >
              New in the shop
            </h2>
            <Link
              to="/shop"
              className="text-sm font-medium underline underline-offset-4"
            >
              See everything in the shop
            </Link>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-x-6 gap-y-10">
            {products.map((p) => (
              <li key={p.id}>
                <ProductCard product={p} lbp={lbp} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/** One step of ordering: these really happen in this order, so they are numbered. */
function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="grid content-start gap-2">
      <p className="flex items-baseline gap-3">
        <span className="font-display text-4xl font-extrabold text-accent tabular-nums">
          {n}
        </span>
        <span className="font-display text-xl font-bold">{title}</span>
      </p>
      <p className="max-w-[36ch] text-text-muted">{children}</p>
    </li>
  );
}
