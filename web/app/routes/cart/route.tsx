import type { OrderSettings } from '@forgea/pricing';
import type { CartView, CurrencyQuote } from '@forgea/types';
import { AddCartItemDto, UpdateCartItemDto } from '@forgea/validation';
import { useState } from 'react';
import { data, Link } from 'react-router';
import { buttonClass } from '~/components/ui/button';
import { OrderSummary } from '~/features/cart/order-summary';
import { useLiveQuote } from '~/features/cart/live-quote';
import { OptionsPicker } from '~/features/cart/options-picker';
import { jsonField, validateForm } from '~/lib/forms.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';
import { CartLineRow } from './cart-line';

export function meta(_: Route.MetaArgs) {
  return [{ title: 'Your cart — Forgea' }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const [cart, settings, currencies] = await Promise.all([
    api.get<CartView>('/cart'),
    api.get<OrderSettings>('/pricing/order-settings'),
    api.get<CurrencyQuote[]>('/currencies'),
  ]);
  if (!cart.ok || !settings.ok || !currencies.ok) {
    // A rate limit stays a 429 ("one moment"); anything else means the API is unavailable.
    const limited = [cart, settings, currencies].some((r) => r.status === 429);
    throw new Response('The cart is unavailable right now', {
      status: limited ? 429 : 503,
    });
  }
  return {
    cart: cart.data,
    settings: settings.data,
    currencies: currencies.data,
  };
}

/** add | update | remove — used by the cart page and by "Add to cart" buttons elsewhere. */
export async function action({ request, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const intent = form.get('intent');
  const lineId = encodeURIComponent(String(form.get('lineId') ?? ''));

  if (intent === 'add') {
    const parsed = validateForm(AddCartItemDto, {
      productId: form.get('productId'),
      quantity: form.get('quantity') ?? 1,
      // The product page sends its choices as JSON: [{ groupId, valueId | text }].
      options: jsonField(form, 'options') ?? [],
      // A personalised piece's design (text, fonts, colours), also as JSON.
      ...(jsonField(form, 'design')
        ? { design: jsonField(form, 'design') }
        : {}),
    });
    if (!parsed.ok)
      return data({ error: 'This product can’t be added' }, { status: 400 });
    const r = await api.post('/cart/items', parsed.value);
    return r.ok
      ? { ok: true }
      : data({ error: r.message }, { status: r.status });
  }
  if (intent === 'update') {
    const parsed = validateForm(UpdateCartItemDto, {
      quantity: form.get('quantity'),
    });
    if (!parsed.ok)
      return data(
        { error: 'Choose a quantity from 1 to 999' },
        { status: 400 },
      );
    const r = await api.patch(`/cart/items/${lineId}`, parsed.value);
    return r.ok
      ? { ok: true }
      : data({ error: r.message }, { status: r.status });
  }
  if (intent === 'remove') {
    const r = await api.delete(`/cart/items/${lineId}`);
    return r.ok
      ? { ok: true }
      : data({ error: r.message }, { status: r.status });
  }
  return data({ error: 'Unknown action' }, { status: 400 });
}

export default function Cart({ loaderData }: Route.ComponentProps) {
  const { cart, settings, currencies } = loaderData;
  const [options, setOptions] = useState({
    delivery: true,
    rush: false,
    currency: 'USD',
  });
  const live = useLiveQuote(
    cart.lines,
    settings,
    options,
    currencies,
    options.currency,
  );

  if (cart.lines.length === 0) {
    return (
      <main className="mx-auto grid max-w-3xl gap-4 px-4 py-16">
        <h1 className="font-display text-4xl font-bold">Your cart is empty</h1>
        <p className="text-text-muted">
          Find something in the shop, or tell us about a custom piece.
        </p>
        <p>
          <Link to="/shop" className={buttonClass()}>
            Go to the shop
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 py-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section
        aria-labelledby="cart-heading"
        className="grid content-start gap-4"
      >
        <h1 id="cart-heading" className="font-display text-4xl font-bold">
          Your cart
        </h1>
        <ul className="grid gap-3">
          {cart.lines.map((line) => (
            <li key={line.id}>
              <CartLineRow line={line} />
            </li>
          ))}
        </ul>
      </section>
      <aside className="grid content-start gap-4">
        <OptionsPicker
          value={options}
          currencies={currencies}
          onChange={setOptions}
        />
        {live && <OrderSummary live={live} />}
        <Link
          to={`/checkout?${new URLSearchParams({
            delivery: String(options.delivery),
            rush: String(options.rush),
            currency: options.currency,
          })}`}
          className={buttonClass('primary', 'w-full py-3 text-base')}
        >
          Checkout
        </Link>
      </aside>
    </main>
  );
}
