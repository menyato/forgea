import {
  ORDER_STATUS_LABELS,
  type OrderListItem,
  OrderStatus,
  type Page,
} from '@forgea/types';
import { ChangeOrderStatusDto } from '@forgea/validation';
import { Money } from '~/components/money';
import { useCan } from '~/features/admin/access';
import { AdminHeader } from '~/features/admin/admin-ui';
import { listState, pageQuery } from '~/features/admin/list-state';
import { save, text } from '~/features/admin/staff.server';
import {
  ControlPanel,
  KanbanView,
  type ListColumn,
  ListView,
} from '~/features/admin/views';
import { apiContext } from '~/lib/request.server';
import { STUDIO_TIME_ZONE, studioDate } from '~/lib/studio-time';
import { statusList } from '~/features/admin/status-list.server';
import { Link } from 'react-router';
import { buttonClass } from '~/components/ui/button';
import type { Route } from './+types/route';

/** The filters: orders by what the studio has to do next; several together add up. */
const FILTERS = [
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
] as const;

/** Every status in the order it happens: the kanban's columns and the groups' order. */
const FLOW = FILTERS.flatMap((f) => f.statuses);

/** The kanban with no filter: one column per step still open. */
const OPEN = FLOW.filter(
  (s) => s !== OrderStatus.DELIVERED && s !== OrderStatus.CANCELLED,
);

const DEFAULTS = { filters: ['confirm'], sorts: ['createdAt', 'total'] };

const GROUPS = [
  { key: 'status', label: 'Status' },
  { key: 'month', label: 'Month placed' },
];

const month = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: STUDIO_TIME_ZONE,
  });

export async function loader({ url, context }: Route.LoaderArgs) {
  const state = listState(url.searchParams, DEFAULTS);
  const { page, ...rest } = await statusList<OrderListItem, OrderStatus>(
    context.get(apiContext),
    state,
    {
      path: '/orders',
      flow: FLOW,
      open: OPEN,
      picked: FILTERS.filter((f) => state.filters.includes(f.key)).flatMap(
        (f) => f.statuses,
      ),
    },
  );
  return { state, orders: page, ...rest };
}

/** A card dragged to another column on the kanban: the same step its page's buttons take. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const id = text(form, 'id') ?? '';
  return save(
    ChangeOrderStatusDto,
    { status: text(form, 'to'), expectedStatus: text(form, 'from') },
    (dto) =>
      context
        .get(apiContext)
        .patch(`/orders/${encodeURIComponent(id)}/status`, dto),
  );
}

const COLUMNS: ListColumn<OrderListItem>[] = [
  {
    key: 'order',
    label: 'Order',
    cell: (o) => (
      <span className="font-mono whitespace-nowrap">{o.orderNumber}</span>
    ),
  },
  {
    key: 'customer',
    label: 'Customer',
    cell: (o) => (
      <span className="grid">
        <span>{o.customerName}</span>
        <span className="text-xs text-text-muted">{o.customerEmail}</span>
      </span>
    ),
  },
  { key: 'items', label: 'What they ordered', cell: (o) => whatOrdered(o) },
  {
    key: 'status',
    label: 'Status',
    cell: (o) => ORDER_STATUS_LABELS[o.status].title,
  },
  {
    key: 'deposit',
    label: 'Deposit',
    cell: (o) =>
      Number(o.depositRequired) === 0 ? (
        <span className="text-text-muted">None</span>
      ) : o.depositPaid ? (
        <span className="text-success">Received</span>
      ) : (
        <span className="text-warning">
          Waiting · <Money amount={o.depositRequired} />
        </span>
      ),
  },
  {
    key: 'total',
    label: 'Total',
    sort: 'total',
    align: 'right',
    cell: (o) => <Money amount={o.total} />,
  },
  {
    key: 'placed',
    label: 'Placed',
    sort: 'createdAt',
    cell: (o) => (
      <span className="text-text-muted">{studioDate(o.createdAt)}</span>
    ),
  },
];

const href = (o: OrderListItem) => `/admin/orders/${o.id}`;

/** "2 × Twist vase, Keychain and 3 more": what an order is, at a glance. */
const whatOrdered = (o: OrderListItem) =>
  o.items
    .map((i) => (i.quantity > 1 ? `${i.quantity} × ${i.name}` : i.name))
    .join(', ') + (o.moreItems > 0 ? ` and ${o.moreItems} more` : '');

export default function Orders({ loaderData }: Route.ComponentProps) {
  const { state, orders, counts, total, columns } = loaderData;
  const can = useCan();
  const mayMove = can('orders.manage');
  // A sale the studio makes itself is written as a quotation and confirmed at once.
  const mayOrder = can('quotations.manage');
  return (
    <>
      <AdminHeader
        title="Orders"
        intro="Filtered by what to do next. Open one to move it to its next step, or drag its card on the kanban; each change is recorded with who made it and shown to the customer."
        action={
          mayOrder && (
            <Link to="/admin/quotations/new?order=1" className={buttonClass()}>
              New order
            </Link>
          )
        }
      />
      <ControlPanel
        state={state}
        search="Order number, name or email"
        filters={FILTERS.map((f) => ({
          key: f.key,
          label: f.label,
          count: f.statuses.reduce((n, s) => n + (counts[s] ?? 0), 0),
        }))}
        groups={GROUPS}
        views={['list', 'kanban']}
        {...(state.view === 'list'
          ? {
              page: {
                shown: orders.items.length,
                total,
                nextCursor: orders.nextCursor,
              },
            }
          : {})}
      />
      {state.view === 'kanban' ? (
        <KanbanView
          move={mayMove}
          href={href}
          columns={columns.map((s) => ({
            key: s,
            title: ORDER_STATUS_LABELS[s].title,
            items: orders.items.filter((o) => o.status === s),
          }))}
          title={(o) => o.orderNumber}
          card={(o) => (
            <>
              <span>{o.customerName}</span>
              <span className="text-text-muted">{whatOrdered(o)}</span>
              <span className="flex justify-between">
                <Money amount={o.total} />
                {Number(o.depositRequired) > 0 && !o.depositPaid && (
                  <span className="text-warning">deposit waiting</span>
                )}
              </span>
            </>
          )}
        />
      ) : (
        <ListView
          label="Orders"
          rows={orders.items}
          columns={COLUMNS}
          href={href}
          state={state}
          empty="No orders here."
          group={(k) =>
            k === 'status'
              ? {
                  of: (o) => ORDER_STATUS_LABELS[o.status].title,
                  order: FLOW.map((s) => ORDER_STATUS_LABELS[s].title),
                }
              : k === 'month'
                ? { of: (o) => month(o.createdAt) }
                : undefined
          }
        />
      )}
    </>
  );
}
