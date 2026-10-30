import type { CustomerOrder, Page, ReorderResult } from '@forgea/types';
import { data, Link, redirect, useSearchParams } from 'react-router';
import { buttonClass } from '~/components/ui/button';
import { CustomerOrderCard } from '~/features/orders/customer-order-card';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export function meta(_: Route.MetaArgs) {
  return [{ title: 'My orders — Forgea' }];
}

const SIGN_IN = `/sign-in?next=${encodeURIComponent('/orders')}`;

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  if (!api.hasSession) throw redirect(SIGN_IN);
  const cursor = url.searchParams.get('cursor');
  const r = await api.get<Page<CustomerOrder>>(
    `/orders/mine?limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
  );
  if (r.status === 401) throw redirect(SIGN_IN);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { orders: r.data };
}

/** reorder | cancel, for one of the customer's own orders (the API checks it is theirs). */
export async function action({ request, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  if (!api.hasSession) throw redirect(SIGN_IN);
  const form = await request.formData();
  const number = encodeURIComponent(String(form.get('number') ?? ''));
  if (form.get('intent') === 'cancel') {
    const r = await api.post(`/orders/mine/${number}/cancel`);
    return r.ok
      ? { cancelled: true as const, reordered: null, error: null }
      : data(
          { cancelled: null, reordered: null, error: r.message },
          { status: r.status },
        );
  }
  const r = await api.post<ReorderResult>(`/orders/mine/${number}/reorder`);
  return r.ok
    ? { cancelled: null, reordered: r.data, error: null }
    : data(
        { cancelled: null, reordered: null, error: r.message },
        { status: r.status },
      );
}

export default function MyOrders({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { orders } = loaderData;
  const [params] = useSearchParams();

  return (
    <main className="mx-auto grid max-w-4xl gap-6 px-4 py-10">
      <h1 className="font-display text-4xl font-bold">My orders</h1>
      <div aria-live="polite">
        {actionData?.reordered && (
          <div className="grid gap-1 rounded-md border border-border bg-surface p-4 text-sm">
            <p>
              {actionData.reordered.added === 0
                ? 'Nothing could go back into your cart.'
                : `${actionData.reordered.added} ${actionData.reordered.added === 1 ? 'item is' : 'items are'} back in your cart.`}{' '}
              {actionData.reordered.added > 0 && (
                <Link
                  to="/cart"
                  className="font-semibold underline underline-offset-4"
                >
                  See your cart
                </Link>
              )}
            </p>
            {actionData.reordered.skipped.map((s) => (
              <p key={s} className="text-text-muted">
                Not added: {s}
              </p>
            ))}
          </div>
        )}
        {actionData?.cancelled && (
          <p className="rounded-md border border-border bg-surface p-4 text-sm">
            Your order is cancelled. We sent you an email to confirm it.
          </p>
        )}
        {actionData?.error && (
          <p role="alert" className="text-danger">
            {actionData.error}
          </p>
        )}
      </div>
      {orders.items.length === 0 ? (
        <p className="text-text-muted">
          No orders yet.{' '}
          <Link to="/shop" className="underline underline-offset-4">
            Browse the shop
          </Link>
          .
        </p>
      ) : (
        <ul className="grid gap-5">
          {orders.items.map((order) => (
            <li key={order.orderNumber}>
              <CustomerOrderCard order={order} />
            </li>
          ))}
        </ul>
      )}
      <nav aria-label="Pages" className="flex gap-4">
        {params.has('cursor') && (
          <Link to="." className={buttonClass('quiet')}>
            Newest orders
          </Link>
        )}
        {orders.nextCursor && (
          <Link
            to={`?cursor=${encodeURIComponent(orders.nextCursor)}`}
            className={buttonClass('secondary')}
          >
            Older orders
          </Link>
        )}
      </nav>
    </main>
  );
}
