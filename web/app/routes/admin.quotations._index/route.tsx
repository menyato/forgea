import {
  type Page,
  type QuotationListItem,
  QuotationStatus,
} from '@forgea/types';
import { Link } from 'react-router';
import { Money } from '~/components/money';
import { buttonClass } from '~/components/ui/button';
import { useCan } from '~/features/admin/access';
import { AdminHeader } from '~/features/admin/admin-ui';
import { listState, pageQuery } from '~/features/admin/list-state';
import {
  ControlPanel,
  KanbanView,
  type ListColumn,
  ListView,
} from '~/features/admin/views';
import { apiContext } from '~/lib/request.server';
import { studioDate } from '~/lib/studio-time';
import type { Route } from './+types/route';

const LABELS: Record<QuotationStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  CONFIRMED: 'Sales order',
  CANCELLED: 'Cancelled',
  DECLINED: 'Declined by the customer',
};

/** Filters by status (several together add up); their keys are the statuses, lower case. */
const STATUSES = Object.values(QuotationStatus);
const key = (s: QuotationStatus) => s.toLowerCase();

/** The kanban with no filter: drafts, sent and confirmed. */
const BOARD = [
  QuotationStatus.DRAFT,
  QuotationStatus.SENT,
  QuotationStatus.CONFIRMED,
];

const DEFAULTS = { sorts: ['createdAt', 'number', 'validUntil'] };

const GROUPS = [
  { key: 'status', label: 'Status' },
  { key: 'customer', label: 'Customer' },
];

export async function loader({ url, context }: Route.LoaderArgs) {
  const state = listState(url.searchParams, DEFAULTS);
  const kanban = state.view === 'kanban';
  const picked = STATUSES.filter((s) => state.filters.includes(key(s)));
  const statuses = picked.length > 0 ? picked : kanban ? BOARD : [];
  const query = pageQuery(state, kanban ? 100 : 50);
  if (statuses.length > 0) query.set('statuses', statuses.join(','));
  const api = context.get(apiContext);
  const [r, counts] = await Promise.all([
    api.get<Page<QuotationListItem>>(`/quotations?${query}`),
    api.get<Partial<Record<QuotationStatus, number>>>('/quotations/counts'),
  ]);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  const count = counts.ok ? counts.data : {};
  return {
    state,
    quotations: r.data,
    counts: count,
    total: state.q
      ? undefined
      : (statuses.length > 0 ? statuses : STATUSES).reduce(
          (n, s) => n + (count[s] ?? 0),
          0,
        ),
    columns: kanban ? STATUSES.filter((s) => statuses.includes(s)) : [],
  };
}

const customer = (q: QuotationListItem) => q.customer.name ?? q.customer.email;

const COLUMNS: ListColumn<QuotationListItem>[] = [
  {
    key: 'number',
    label: 'Number',
    sort: 'number',
    cell: (q) => (
      <span className="font-mono whitespace-nowrap">{q.number}</span>
    ),
  },
  {
    key: 'customer',
    label: 'Customer',
    cell: (q) => (
      <>
        {customer(q)}
        {q.customer.id === null && (
          <span className="block text-xs text-text-muted">
            no account yet · by email
          </span>
        )}
      </>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    cell: (q) => (
      <>
        {q.expired ? 'Expired' : LABELS[q.status]}
        {q.orderNumber && (
          <span className="block font-mono text-xs text-text-muted">
            {q.orderNumber}
          </span>
        )}
      </>
    ),
  },
  {
    key: 'valid',
    label: 'Valid until',
    sort: 'validUntil',
    cell: (q) => q.validUntil,
  },
  {
    key: 'total',
    label: 'Total',
    align: 'right',
    cell: (q) => <Money amount={q.total} />,
  },
  {
    key: 'created',
    label: 'Written',
    sort: 'createdAt',
    cell: (q) => (
      <span className="text-text-muted">{studioDate(q.createdAt)}</span>
    ),
  },
];

const href = (q: QuotationListItem) => `/admin/quotations/${q.id}`;

export default function Quotations({ loaderData }: Route.ComponentProps) {
  const { state, quotations, counts, total, columns } = loaderData;
  const mayWrite = useCan()('quotations.manage');
  return (
    <>
      <AdminHeader
        title="Quotations"
        intro="Prices you write for a customer. Send one and they can accept it online; confirming it creates the order."
        action={
          mayWrite && (
            <Link to="/admin/quotations/new" className={buttonClass()}>
              New quotation
            </Link>
          )
        }
      />
      <ControlPanel
        state={state}
        search="Number, customer or email"
        filters={STATUSES.map((s) => ({
          key: key(s),
          label: LABELS[s],
          count: counts[s] ?? 0,
        }))}
        groups={GROUPS}
        views={['list', 'kanban']}
        {...(state.view === 'list'
          ? {
              page: {
                shown: quotations.items.length,
                total,
                nextCursor: quotations.nextCursor,
              },
            }
          : {})}
      />
      {state.view === 'kanban' ? (
        <KanbanView
          href={href}
          columns={columns.map((s) => ({
            key: s,
            title: LABELS[s],
            items: quotations.items.filter((q) => q.status === s),
          }))}
          title={(q) => q.number}
          card={(q) => (
            <>
              <span className="text-text-muted">{customer(q)}</span>
              <span className="flex justify-between">
                <Money amount={q.total} />
                {q.expired && <span className="text-warning">expired</span>}
              </span>
            </>
          )}
        />
      ) : (
        <ListView
          label="Quotations"
          rows={quotations.items}
          columns={COLUMNS}
          href={href}
          state={state}
          empty="No quotations here."
          group={(k) =>
            k === 'status'
              ? {
                  of: (q) => LABELS[q.status],
                  order: STATUSES.map((s) => LABELS[s]),
                }
              : k === 'customer'
                ? { of: customer }
                : undefined
          }
        />
      )}
    </>
  );
}
