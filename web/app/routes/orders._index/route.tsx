import type { CustomerOrder, Page } from '@forgea/types';
import { Link, redirect, useSearchParams } from 'react-router';
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

export default function MyOrders({ loaderData }: Route.ComponentProps) {
  const { orders } = loaderData;
  const [params] = useSearchParams();

  return (
    <main className="mx-auto grid max-w-4xl gap-6 px-4 py-10">
      <h1 className="font-display text-4xl font-bold">My orders</h1>
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
