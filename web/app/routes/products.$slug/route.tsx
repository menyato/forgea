import { CurrencyConverter, type OrderSettings } from '@forgea/pricing';
import {
  formatSizeCm,
  type CurrencyQuote,
  OptionKind,
  type OptionSelection,
  type ProductDetail,
} from '@forgea/types';
import { CART_QUANTITY_MAX } from '@forgea/validation/constants';
import { ProductPriceDto } from '@forgea/validation';
import { useEffect, useMemo, useState } from 'react';
import { data, Link, useFetcher, useRouteLoaderData } from 'react-router';
import { Busy } from '~/components/brand/busy';
import { PAGE_WIDTH } from '~/components/layout/page-width';
import { Money } from '~/components/money';
import { Button, buttonClass } from '~/components/ui/button';
import { WhatsAppLink } from '~/features/contact/whatsapp-link';
import { ModelViewer } from '~/features/model-viewer/model-viewer';
import { productJsonLd, seoMeta, siteOrigin } from '~/features/seo/seo';
import { jsonField, validateForm } from '~/lib/forms.server';
import { apiContext } from '~/lib/request.server';
import type { loader as rootLoader } from '~/root';
import type { Route } from './+types/route';
import { type Choices, OptionPicker } from './option-picker';
import { TextDesigner } from './text-designer';

export function meta({ loaderData: d, matches }: Route.MetaArgs) {
  if (!d) return [{ title: 'Product not found — Forgea' }];
  const origin = siteOrigin(matches);
  return [
    ...seoMeta({
      origin,
      path: `/products/${d.product.slug}`,
      title: `${d.product.name} — Forgea`,
      description: d.product.description.slice(0, 160),
      // The first photo, when the product has one; otherwise the brand card.
      image: d.product.imageKeys[0] && `/media/${d.product.imageKeys[0]}`,
    }),
    ...(origin ? [productJsonLd(d.product, origin)] : []),
  ];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const [product, currencies, settings] = await Promise.all([
    api.get<ProductDetail>(`/products/${encodeURIComponent(params.slug)}`),
    api.get<CurrencyQuote[]>('/currencies'),
    api.get<OrderSettings>('/pricing/order-settings'),
  ]);
  if (!product.ok)
    throw new Response('Product not found', { status: product.status });
  return {
    product: product.data,
    lbp: currencies.ok
      ? (currencies.data.find((c) => c.code === 'LBP') ?? null)
      : null,
    depositPercent: settings.ok ? settings.data.depositPercent : null,
  };
}

/** The live price for the current choices (the API prices; the browser never does). */
export async function action({ request, params, context }: Route.ActionArgs) {
  const form = await request.formData();
  const design = jsonField(form, 'design');
  const parsed = validateForm(ProductPriceDto, {
    options: jsonField(form, 'options') ?? [],
    ...(design ? { design } : {}),
  });
  if (!parsed.ok) return data({ error: 'Check your choices' }, { status: 400 });
  const r = await context.get(apiContext).post<{
    unitPrice: string;
  }>(`/products/${encodeURIComponent(params.slug)}/price`, parsed.value);
  return r.ok
    ? { unitPrice: r.data.unitPrice }
    : data({ error: r.message }, { status: r.status });
}

const initialChoices = (product: ProductDetail): Choices =>
  Object.fromEntries(
    product.options.flatMap((o) =>
      o.defaultValueId ? [[o.groupId, o.defaultValueId]] : [],
    ),
  );

const toSelections = (product: ProductDetail, choices: Choices) =>
  product.options.flatMap((o): OptionSelection[] => {
    const v = choices[o.groupId]?.trim();
    if (!v) return [];
    return [
      o.kind === OptionKind.TEXT
        ? { groupId: o.groupId, text: v }
        : { groupId: o.groupId, valueId: v },
    ];
  });

export default function ProductPage({ loaderData }: Route.ComponentProps) {
  // Personalised: the customer designs their piece and sees it in 3D.
  if (loaderData.product.text)
    return (
      <TextDesigner
        product={loaderData.product}
        offer={loaderData.product.text}
      />
    );
  return <CatalogProduct {...loaderData} />;
}

function CatalogProduct({
  product,
  lbp,
  depositPercent,
}: Route.ComponentProps['loaderData']) {
  const store = useRouteLoaderData<typeof rootLoader>('root')?.store ?? null;
  const [choices, setChoices] = useState<Choices>(() =>
    initialChoices(product),
  );
  const [quantity, setQuantity] = useState(1);
  const pricing = useFetcher<typeof action>();
  const cart = useFetcher<{ ok?: boolean; error?: string }>();

  const selections = useMemo(
    () => toSelections(product, choices),
    [product, choices],
  );
  const missing = product.options.filter(
    (o) => o.required && !choices[o.groupId]?.trim(),
  );
  const optionsJson = JSON.stringify(selections);

  // Re-price as choices change; typing a name waits for a pause.
  const { submit: requestPrice } = pricing;
  const complete = missing.length === 0;
  useEffect(() => {
    if (!complete) return;
    const timer = setTimeout(
      () => void requestPrice({ options: optionsJson }, { method: 'post' }),
      250,
    );
    return () => clearTimeout(timer);
  }, [requestPrice, optionsJson, complete]);

  const quoted =
    pricing.data && 'unitPrice' in pricing.data ? pricing.data.unitPrice : null;
  const priceError =
    pricing.data && 'error' in pricing.data ? pricing.data.error : null;
  const unitPrice = quoted ?? product.price;
  const lbpPrice = lbp
    ? new CurrencyConverter(lbp, lbp.rate).convert(unitPrice)
    : null;
  const color = product.options
    .flatMap((o) => o.choices)
    .find(
      (c) => c.swatchHex && Object.values(choices).includes(c.id),
    )?.swatchHex;
  // "Added" only while the choices are the ones that went in: another size or colour is a new line.
  const [addedFor, setAddedFor] = useState<string | null>(null);
  const added =
    cart.state === 'idle' &&
    cart.data !== undefined &&
    !cart.data.error &&
    addedFor === optionsJson;

  return (
    <main
      className={`${PAGE_WIDTH} grid gap-x-12 gap-y-8 pb-10 sm:pt-8 lg:grid-cols-[minmax(0,7fr)_minmax(22rem,5fr)]`}
    >
      {/* Edge to edge on phones; beside the details, and sticky, on wider screens. */}
      <div className="-mx-4 sm:mx-0 lg:sticky lg:top-24 lg:self-start">
        {product.modelKey ? (
          <ModelViewer
            modelKey={product.modelKey}
            label={product.name}
            color={color ?? undefined}
            className="sm:rounded-lg lg:aspect-auto lg:h-[min(78dvh,52rem)]"
          />
        ) : (
          <div
            aria-hidden="true"
            className="grid aspect-square place-items-center bg-surface font-display text-5xl font-bold text-text-muted sm:rounded-lg lg:aspect-auto lg:h-[min(78dvh,52rem)]"
          >
            {product.material.code}
          </div>
        )}
      </div>

      <div className="grid content-start gap-6 lg:py-4">
        <nav aria-label="Breadcrumb" className="text-sm text-text-muted">
          <Link to="/shop" className="hover:underline">
            Shop
          </Link>
          {product.category && (
            <>
              {' / '}
              <Link
                to={`/shop?category=${product.category.slug}`}
                className="hover:underline"
              >
                {product.category.name}
              </Link>
            </>
          )}
        </nav>
        <header className="grid gap-2">
          <h1 className="font-display text-[clamp(2.25rem,4vw,3.5rem)] leading-none font-extrabold tracking-tight text-balance">
            {product.name}
          </h1>
          <p className="max-w-[60ch] text-lg text-text-muted">
            {product.description}
          </p>
          {product.size && (
            <p className="text-sm">
              Size: {formatSizeCm(product.size)}{' '}
              <span className="text-text-muted">(width × depth × height)</span>
            </p>
          )}
          {product.designer && (
            <p className="text-sm">Designed by {product.designer}</p>
          )}
        </header>

        {product.options.map((o) => (
          <OptionPicker
            key={o.groupId}
            option={o}
            value={choices[o.groupId]}
            onChange={(v) => setChoices((c) => ({ ...c, [o.groupId]: v }))}
          />
        ))}

        <div aria-live="polite" className="grid gap-1">
          <p className="text-3xl font-bold">
            {missing.length > 0 && 'from '}
            <Money amount={unitPrice} />
            {pricing.state !== 'idle' && (
              <span className="ml-2 text-sm font-normal text-text-muted">
                updating…
              </span>
            )}
          </p>
          {lbpPrice && lbp && (
            <p className="text-sm text-text-muted">
              ≈ <Money amount={lbpPrice} currency={lbp} /> each
            </p>
          )}
          {product.isCustom && depositPercent && (
            <p className="text-sm">
              Made to order: a {Number(depositPercent)}% deposit starts
              production.
            </p>
          )}
          {priceError && <p className="text-sm text-danger">{priceError}</p>}
        </div>

        <cart.Form
          method="post"
          action="/cart"
          className="flex flex-wrap items-end gap-3"
          onSubmit={() => setAddedFor(optionsJson)}
        >
          <input type="hidden" name="intent" value="add" />
          <input type="hidden" name="productId" value={product.id} />
          <input type="hidden" name="options" value={optionsJson} />
          <label className="grid gap-1 text-sm">
            <span>Quantity</span>
            <input
              type="number"
              name="quantity"
              autoComplete="off"
              min={1}
              max={CART_QUANTITY_MAX}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.currentTarget.value) || 1)}
              className="w-20 rounded-md border border-border bg-surface px-2 py-2"
            />
          </label>
          <Button
            type="submit"
            disabled={missing.length > 0 || cart.state !== 'idle'}
            className="flex-1 py-2.5 text-base"
          >
            {missing.length > 0 ? (
              `Choose ${missing.map((o) => o.name).join(' and ')}`
            ) : cart.state !== 'idle' ? (
              <Busy label="Adding…" />
            ) : added ? (
              'Added — add another'
            ) : (
              'Add to cart'
            )}
          </Button>
        </cart.Form>
        {cart.data?.error && (
          <p className="text-sm text-danger">{cart.data.error}</p>
        )}
        {added && (
          <p className="text-sm">
            In your cart.{' '}
            <Link to="/cart" className={buttonClass('quiet')}>
              View cart
            </Link>
          </p>
        )}
        {store && (
          <WhatsAppLink
            phone={store.whatsappPhone}
            message={`Hello Forgea! A question about "${product.name}".`}
            className={buttonClass('secondary', 'justify-self-start')}
          >
            Ask about this on WhatsApp
          </WhatsAppLink>
        )}
      </div>
    </main>
  );
}
