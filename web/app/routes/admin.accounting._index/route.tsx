import type { InvoiceCounts, InvoiceListItem, Page } from '@forgea/types';
import { INVOICE_FILTERS } from '@forgea/validation/constants';
import { Link } from 'react-router';
import { Money } from '~/components/money';
import { buttonClass } from '~/components/ui/button';
import { kindOf, stateOf } from '~/features/accounting/invoice-table';
import { can } from '~/features/admin/access';
import { AdminHeader } from '~/features/admin/admin-ui';
import { listState, pageQuery } from '~/features/admin/list-state';
import { staffContext } from '~/features/admin/staff.server';
import {
  ControlPanel,
  type ListColumn,
  ListView,
} from '~/features/admin/views';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** What is open, what is settled, what was given back; several together add up (the API filters). */
const FILTERS = [
  { key: 'draft', label: 'Drafts' },
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'paid', label: 'Paid' },
  { key: 'credit', label: 'Credit notes' },
] as const satisfies readonly {
  key: (typeof INVOICE_FILTERS)[number];
  label: string;
}[];

const DEFAULTS = {
  filters: ['unpaid'],
  sorts: ['date', 'number', 'total', 'residual'],
};

const GROUPS = [
  { key: 'state', label: 'State' },
  { key: 'customer', label: 'Customer' },
  { key: 'month', label: 'Month' },
];

const customerOf = (i: InvoiceListItem) =>
  i.customer?.name ?? i.customer?.email ?? 'No customer';

const month = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const state = listState(url.searchParams, DEFAULTS);
  const picked = FILTERS.filter((f) => state.filters.includes(f.key));
  const query = pageQuery(state, 50);
  if (picked.length > 0)
    query.set('filters', picked.map((f) => f.key).join(','));
  const [r, counts] = await Promise.all([
    api.get<Page<InvoiceListItem>>(`/accounting/invoices?${query}`),
    api.get<InvoiceCounts>('/accounting/invoices/counts'),
  ]);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  if (!counts.ok) throw new Response(counts.message, { status: counts.status });
  const c = counts.data;
  return {
    state,
    page: r.data,
    counts: {
      draft: c.draft,
      unpaid: c.unpaid,
      paid: c.paid,
      credit: c.credit,
    },
    owed: Number(c.owed),
    // Without a search, the filters' counts say how many there are in all.
    total: state.q
      ? undefined
      : [...(picked.length > 0 ? picked : FILTERS)].reduce(
          (n, f) => n + c[f.key],
          0,
        ),
    books: can(context.get(staffContext), 'books.view'),
  };
}

const COLUMNS: ListColumn<InvoiceListItem>[] = [
  {
    key: 'number',
    label: 'Number',
    sort: 'number',
    cell: (i) => <span className="font-mono">{i.number}</span>,
  },
  {
    key: 'kind',
    label: 'Kind',
    cell: (i) => <span className="text-text-muted">{kindOf(i)}</span>,
  },
  { key: 'date', label: 'Date', sort: 'date', cell: (i) => i.date },
  {
    key: 'order',
    label: 'Order',
    cell: (i) => <span className="font-mono">{i.orderNumber ?? ''}</span>,
  },
  { key: 'customer', label: 'Customer', cell: customerOf },
  {
    key: 'total',
    label: 'Total',
    sort: 'total',
    align: 'right',
    cell: (i) => <Money amount={i.total} />,
  },
  {
    key: 'residual',
    label: 'Still owed',
    sort: 'residual',
    align: 'right',
    cell: (i) => <Money amount={i.residual} />,
  },
  {
    key: 'state',
    label: 'State',
    cell: (i) => (
      <span className={stateOf(i).tone}>
        {stateOf(i).label}
        {i.creditedBy && (
          <span className="block text-xs text-text-muted">
            credited by {i.creditedBy}
          </span>
        )}
      </span>
    ),
  },
];

/** The states in the order money moves (the groups' order). */
const STATE_ORDER = [
  'Not paid',
  'Partly paid',
  'Paid',
  'Credited',
  'To refund',
  'Settled',
];

export default function Accounting({ loaderData }: Route.ComponentProps) {
  const { state, page, counts, owed, total, books } = loaderData;
  return (
    <>
      <AdminHeader
        title="Invoices"
        intro={`Still owed: ${owed.toFixed(2)}. Invoices are made by the orders themselves: a deposit invoice when the deposit arrives, the final invoice on delivery. Record payments and credit notes from the order's page.`}
        action={
          books ? (
            <span className="flex gap-2">
              <Link
                to="/admin/accounting/reports"
                className={buttonClass('secondary')}
              >
                Reports
              </Link>
              <Link
                to="/admin/accounting/books"
                className={buttonClass('secondary')}
              >
                Books
              </Link>
            </span>
          ) : undefined
        }
      />
      <ControlPanel
        state={state}
        search="Number, order or customer"
        filters={FILTERS.map((f) => ({
          key: f.key,
          label: f.label,
          count: counts[f.key],
        }))}
        groups={GROUPS}
        page={{
          shown: page.items.length,
          total,
          nextCursor: page.nextCursor,
        }}
      />
      <ListView
        label="Invoices"
        rows={page.items}
        columns={COLUMNS}
        href={(i) => `/admin/accounting/invoices/${i.id}`}
        state={state}
        empty="No invoices here."
        group={(k) =>
          k === 'state'
            ? { of: (i) => stateOf(i).label, order: STATE_ORDER }
            : k === 'customer'
              ? { of: customerOf }
              : k === 'month'
                ? { of: (i) => month(i.date) }
                : undefined
        }
      />
    </>
  );
}
