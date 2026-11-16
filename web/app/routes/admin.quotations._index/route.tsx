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
import { statusList } from '~/features/admin/status-list.server';
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
  const { page, ...rest } = await statusList<
    QuotationListItem,
    QuotationStatus
  >(context.get(apiContext), state, {
    path: '/quotations',
    flow: STATUSES,
    open: BOARD,
    picked: STATUSES.filter((s) => state.filters.includes(key(s))),
  });
  return { state, quotations: page, ...rest };
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
