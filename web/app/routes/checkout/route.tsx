import type { OrderSettings } from '@forgea/pricing';
import type { CartView, CheckoutResult, CurrencyQuote } from '@forgea/types';
import { data, redirect, useRouteLoaderData } from 'react-router';
import { PAGE_WIDTH } from '~/components/layout/page-width';
import { signInFor } from '~/features/auth/sign-in-links.server';
import { OrderConfirmation } from '~/features/orders/order-confirmation';
import { OrderForm } from '~/features/orders/order-form';
import { parseOrderForm } from '~/features/orders/order-form.server';
import { apiContext } from '~/lib/request.server';
import type { loader as rootLoader } from '~/root';
import type { Route } from './+types/route';

export function meta(_: Route.MetaArgs) {
  return [{ title: 'Checkout — Forgea' }];
}

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  // Anyone can browse and fill a cart; ordering needs an account (the cart is kept).
  if (!api.hasSession) throw redirect(signInFor(url));
  const [cart, settings, currencies] = await Promise.all([
    api.get<CartView>('/cart'),
    api.get<OrderSettings>('/pricing/order-settings'),
    api.get<CurrencyQuote[]>('/currencies'),
  ]);
  if (!cart.ok || !settings.ok || !currencies.ok) {
    // A rate limit stays a 429 ("one moment"); anything else means the API is unavailable.
    const limited = [cart, settings, currencies].some((r) => r.status === 429);
    throw new Response('Checkout is unavailable right now', {
      status: limited ? 429 : 503,
    });
  }
  return {
    cart: cart.data,
    settings: settings.data,
    currencies: currencies.data,
    // Carried over from the cart page's choices.
    initial: {
      delivery: url.searchParams.get('delivery') !== 'false',
      rush: url.searchParams.get('rush') === 'true',
      currency: url.searchParams.get('currency') ?? 'USD',
    },
    idempotencyKey: crypto.randomUUID(),
  };
}

export async function action({ request, url, context }: Route.ActionArgs) {
  const parsed = parseOrderForm(await request.formData());
  if (!parsed.ok) {
    return data(
      { errors: parsed.errors, message: undefined, result: undefined },
      { status: 400 },
    );
  }
  const r = await context
    .get(apiContext)
    .post<CheckoutResult>('/orders/checkout', parsed.value);
  if (!r.ok) {
    // The session ended while the form was open: sign in again, then come back here.
    if (r.status === 401) throw redirect(signInFor(url));
    if (r.message === 'Your cart is empty') throw redirect('/cart');
    return data(
      { errors: {}, message: r.message, result: undefined },
      { status: r.status },
    );
  }
  return { errors: {}, message: undefined, result: r.data };
}

export default function Checkout({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { cart, settings, currencies, initial, idempotencyKey } = loaderData;
  const store = useRouteLoaderData<typeof rootLoader>('root')?.store ?? null;

  if (actionData?.result)
    return (
      <OrderConfirmation
        result={actionData.result}
        currencies={currencies}
        store={store}
      />
    );
  if (cart.lines.length === 0) {
    return (
      <main className={`${PAGE_WIDTH} py-16`}>
        <h1 className="font-display text-4xl font-bold">Your cart is empty</h1>
      </main>
    );
  }
  return (
    <main className={`${PAGE_WIDTH} py-10`}>
      <h1 className="mb-8 font-display text-5xl font-extrabold tracking-tight">
        Checkout
      </h1>
      <OrderForm
        lines={cart.lines}
        settings={settings}
        currencies={currencies}
        initial={initial}
        idempotencyKey={idempotencyKey}
        errors={actionData?.errors ?? {}}
        message={actionData?.message}
        submitLabel="Place order"
      />
    </main>
  );
}
