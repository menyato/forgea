import {
  ORDER_STATUS_LABELS,
  type OrderListItem,
  OrderStatus,
  type Page,
} from '@forgea/types';
import { Form, Link, useSearchParams } from 'react-router';
import { Money } from '~/components/money';
import { buttonClass } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { AdminHeader } from '~/features/admin/admin-ui';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ url, context }: Route.LoaderArgs) {
  const query = new URLSearchParams({ limit: '50' });
  for (const key of ['status', 'q', 'cursor'] as const) {
    const v = url.searchParams.get(key);
    if (v) query.set(key, v);
  }
  const r = await context
    .get(apiContext)
    .get<Page<OrderListItem>>(`/orders?${query}`);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { orders: r.data };
}

/** The statuses staff act on, in the order work flows. */
const TABS = [
  null,
  OrderStatus.PENDING,
  OrderStatus.AWAITING_DEPOSIT,
  OrderStatus.CONFIRMED,
  OrderStatus.IN_PRODUCTION,
  OrderStatus.READY,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
] as const;

export default function Orders({ loaderData }: Route.ComponentProps) {
  const { orders } = loaderData;
  const [params] = useSearchParams();
  const status = params.get('status');
  const tab = (s: OrderStatus | null) => {
    const next = new URLSearchParams(params);
    next.delete('cursor');
    if (s) next.set('status', s);
    else next.delete('status');
    return `?${next}`;
  };
  const more = new URLSearchParams(params);
  if (orders.nextCursor) more.set('cursor', orders.nextCursor);

  return (
    <>
      <AdminHeader
        title="Orders"
        intro="Every order, newest first. Open one to move it to its next step; each change is recorded with who made it and shown to the customer."
        action={
          <Form method="get" role="search" className="flex items-end gap-2">
            {status && <input type="hidden" name="status" value={status} />}
            <Field
              label="Order number or email"
              name="q"
              type="search"
              defaultValue={params.get('q') ?? ''}
            />
            <button type="submit" className={buttonClass('secondary')}>
              Search
            </button>
          </Form>
        }
      />
      <nav aria-label="Order status" className="mb-6 flex flex-wrap gap-2">
        {TABS.map((s) => (
          <Link
            key={s ?? 'all'}
            to={tab(s)}
            aria-current={status === s ? 'page' : undefined}
            className={`rounded-pill border px-3 py-1 text-sm ${
              status === s
                ? 'border-accent bg-accent text-on-accent'
                : 'border-border text-text-muted hover:text-text'
            }`}
          >
            {s ? ORDER_STATUS_LABELS[s].title : 'All'}
          </Link>
        ))}
      </nav>
      {orders.items.length === 0 ? (
        <p className="text-text-muted">No orders here.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="text-left text-text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Deposit</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Placed</th>
              </tr>
            </thead>
            <tbody>
              {orders.items.map((o) => (
                <tr key={o.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <Link
                      to={`/admin/orders/${o.id}`}
                      className="font-mono font-semibold underline-offset-4 hover:underline"
                    >
                      {o.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{o.customerEmail}</td>
                  <td className="px-4 py-3">
                    {ORDER_STATUS_LABELS[o.status].title}
                  </td>
                  <td className="px-4 py-3">
                    {Number(o.depositRequired) === 0 ? (
                      <span className="text-text-muted">None</span>
                    ) : o.depositPaid ? (
                      <span className="text-success">Received</span>
                    ) : (
                      <span className="text-warning">
                        Waiting · <Money amount={o.depositRequired} />
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Money amount={o.total} />
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    {new Date(o.createdAt).toLocaleDateString('en-GB')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {orders.hasMore && (
        <Link to={`?${more}`} className={buttonClass('secondary', 'mt-4')}>
          Next page
        </Link>
      )}
    </>
  );
}
