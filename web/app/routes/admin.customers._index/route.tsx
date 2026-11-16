import type { CustomerList, CustomerListItem } from '@forgea/types';
import { Money } from '~/components/money';
import { AdminHeader } from '~/features/admin/admin-ui';
import { accountText } from '~/features/customers/account-text';
import { listState } from '~/features/admin/list-state';
import {
  ControlPanel,
  KanbanView,
  type ListColumn,
  ListView,
} from '~/features/admin/views';
import { apiContext } from '~/lib/request.server';
import { STUDIO_TIME_ZONE } from '~/lib/studio-time';
import type { Route } from './+types/route';

/** With an account, or known only by email (the website form, a quotation sent to them). */
const FILTERS = [
  { key: 'account', label: 'With an account', only: 'kind' },
  { key: 'guest', label: 'Without an account', only: 'kind' },
  { key: 'new', label: 'New this week', only: 'week' },
  { key: 'seen', label: 'Signed in this week', only: 'week' },
];

const DEFAULTS = { sorts: ['lastActivity', 'spent', 'orders', 'email'] };

export function meta(_: Route.MetaArgs) {
  return [{ title: 'Customers — Forgea' }];
}

export async function loader({ url, context }: Route.LoaderArgs) {
  const state = listState(url.searchParams, DEFAULTS);
  const query = new URLSearchParams({ sort: state.sort, order: state.order });
  if (state.q) query.set('q', state.q);
  if (state.cursor) query.set('cursor', state.cursor);
  const kind = state.filters.find((f) => f === 'account' || f === 'guest');
  if (kind) query.set('kind', kind);
  const week = state.filters.find((f) => f === 'new' || f === 'seen');
  if (week) query.set('week', week);
  const r = await context
    .get(apiContext)
    .get<CustomerList>(`/customers?${query}`);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { state, customers: r.data };
}

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: STUDIO_TIME_ZONE,
  });

const COLUMNS: ListColumn<CustomerListItem>[] = [
  {
    key: 'email',
    label: 'Customer',
    sort: 'email',
    cell: (c) => (
      <span className="grid">
        <span>{c.name ?? c.email}</span>
        {c.name && <span className="text-xs text-text-muted">{c.email}</span>}
      </span>
    ),
  },
  { key: 'phone', label: 'Phone', cell: (c) => c.phone ?? '—' },
  {
    key: 'account',
    label: 'Account',
    cell: (c) =>
      c.account ? (
        accountText(c)
      ) : (
        <span className="text-text-muted">No account</span>
      ),
  },
  { key: 'orders', label: 'Orders', sort: 'orders', cell: (c) => c.orders },
  {
    key: 'spent',
    label: 'Spent',
    sort: 'spent',
    cell: (c) => <Money amount={c.spent} />,
  },
  {
    key: 'more',
    label: 'Quotations · requests · leads',
    cell: (c) => `${c.quotations} · ${c.requests} · ${c.leads}`,
  },
  {
    key: 'lastSeen',
    label: 'Last signed in',
    cell: (c) =>
      c.lastSeen ? (
        date(c.lastSeen)
      ) : (
        <span className="text-text-muted">{c.account ? 'Not yet' : '—'}</span>
      ),
  },
  {
    key: 'lastActivity',
    label: 'Last activity',
    sort: 'lastActivity',
    cell: (c) => date(c.lastActivity),
  },
];

export default function Customers({ loaderData }: Route.ComponentProps) {
  const { state, customers } = loaderData;
  return (
    <>
      <AdminHeader
        title="Customers"
        intro={`Everyone the studio knows: customer accounts, and people known only by their email (the website form, a quotation sent to them). ${customers.guestCarts} visitor${customers.guestCarts === 1 ? ' has' : 's have'} something in a cart without signing in.`}
      />
      <ControlPanel
        state={state}
        search="Name, email or phone"
        filters={FILTERS}
        views={['list', 'kanban']}
        page={{
          shown: customers.items.length,
          total: customers.total,
          nextCursor: customers.nextCursor,
        }}
      />
      {state.view === 'kanban' ? (
        <KanbanView
          href={(c) => `/admin/customers/${encodeURIComponent(c.email)}`}
          columns={[
            {
              key: 'account',
              title: 'With an account',
              items: customers.items.filter((c) => c.account),
            },
            {
              key: 'guest',
              title: 'Without an account',
              items: customers.items.filter((c) => !c.account),
            },
          ]}
          title={(c) => c.name ?? c.email}
          card={(c) => (
            <span className="grid gap-0.5 text-xs text-text-muted">
              {c.name && <span>{c.email}</span>}
              <span>
                {c.orders} order{c.orders === 1 ? '' : 's'} ·{' '}
                <Money amount={c.spent} /> · {c.quotations} quotation
                {c.quotations === 1 ? '' : 's'}
              </span>
            </span>
          )}
        />
      ) : (
        <ListView
          label="Customers"
          rows={customers.items}
          columns={COLUMNS}
          href={(c) => `/admin/customers/${encodeURIComponent(c.email)}`}
          state={state}
          empty="No customers found."
        />
      )}
    </>
  );
}
