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
import {
  Board,
  BoardCard,
  ViewSwitch,
  ViewTabs,
  viewMode,
} from '~/features/admin/views';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** The tabs: orders grouped by what the studio has to do next. */
const TABS = [
  {
    key: 'confirm',
    label: 'To confirm',
    statuses: [OrderStatus.PENDING, OrderStatus.AWAITING_DEPOSIT],
  },
  {
    key: 'production',
    label: 'In production',
    statuses: [OrderStatus.CONFIRMED, OrderStatus.IN_PRODUCTION],
  },
  {
    key: 'delivery',
    label: 'Ready & delivery',
    statuses: [OrderStatus.READY, OrderStatus.OUT_FOR_DELIVERY],
  },
  { key: 'delivered', label: 'Delivered', statuses: [OrderStatus.DELIVERED] },
  { key: 'cancelled', label: 'Cancelled', statuses: [OrderStatus.CANCELLED] },
  { key: 'all', label: 'All', statuses: [] },
] as const;

/** The board: one column per step still open. */
const OPEN = [
  OrderStatus.PENDING,
  OrderStatus.AWAITING_DEPOSIT,
  OrderStatus.CONFIRMED,
  OrderStatus.IN_PRODUCTION,
  OrderStatus.READY,
  OrderStatus.OUT_FOR_DELIVERY,
] as const;

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const board = viewMode(url.searchParams) === 'board';
  const tab =
    TABS.find((t) => t.key === url.searchParams.get('tab')) ?? TABS[0];
  const query = new URLSearchParams({ limit: board ? '100' : '50' });
  // A search looks through every order, whatever tab is open.
  const searching = url.searchParams.has('q');
  const statuses = board ? OPEN : searching ? [] : tab.statuses;
  if (statuses.length > 0) query.set('statuses', statuses.join(','));
  for (const key of ['q', 'cursor'] as const) {
    const v = url.searchParams.get(key);
    if (v) query.set(key, v);
  }
  const [r, counts] = await Promise.all([
    api.get<Page<OrderListItem>>(`/orders?${query}`),
    api.get<Partial<Record<OrderStatus, number>>>('/orders/counts'),
  ]);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return {
    orders: r.data,
    tab: searching ? 'all' : tab.key,
    counts: counts.ok ? counts.data : {},
  };
}

export default function Orders({ loaderData }: Route.ComponentProps) {
  const { orders, tab, counts } = loaderData;
  const [params] = useSearchParams();
  const mode = viewMode(params);
  const more = new URLSearchParams(params);
  if (orders.nextCursor) more.set('cursor', orders.nextCursor);
  const count = (statuses: readonly OrderStatus[]) =>
    statuses.reduce((n, s) => n + (counts[s] ?? 0), 0);

  return (
    <>
      <AdminHeader
        title="Orders"
        intro="Grouped by what to do next. Open one to move it to its next step; each change is recorded with who made it and shown to the customer."
        action={
          <div className="flex flex-wrap items-end gap-3">
            <Form method="get" role="search" className="flex items-end gap-2">
              {[...params]
                .filter(([k]) => k !== 'q' && k !== 'cursor')
                .map(([k, v]) => (
                  <input key={k} type="hidden" name={k} value={v} />
                ))}
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
            <ViewSwitch current={mode} />
          </div>
        }
      />
      {mode === 'board' ? (
        <Board
          columns={OPEN.map((s) => ({
            key: s,
            title: ORDER_STATUS_LABELS[s].title,
            items: orders.items.filter((o) => o.status === s),
          }))}
          card={(o) => (
            <BoardCard to={`/admin/orders/${o.id}`} title={o.orderNumber}>
              <span className="text-text-muted">{o.customerEmail}</span>
              <span className="flex justify-between">
                <Money amount={o.total} />
                {Number(o.depositRequired) > 0 && !o.depositPaid && (
                  <span className="text-warning">deposit waiting</span>
                )}
              </span>
            </BoardCard>
          )}
        />
      ) : (
        <>
          <ViewTabs
            label="Order groups"
            current={tab}
            tabs={TABS.map((t) => ({
              key: t.key,
              label: t.label,
              ...(t.key === 'all' ||
              t.key === 'delivered' ||
              t.key === 'cancelled'
                ? {}
                : { count: count(t.statuses) }),
            }))}
          />
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
      )}
    </>
  );
}
