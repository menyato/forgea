import {
  CUSTOM_REQUEST_STATUS_LABELS,
  type CustomRequestListItem,
  CustomRequestStatus,
  type Page,
} from '@forgea/types';
import { Money } from '~/components/money';
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

/** The filters: new requests, those waiting on the customer, then the rest; they add up. */
const FILTERS = [
  { key: 'new', label: 'New', statuses: [CustomRequestStatus.SUBMITTED] },
  {
    key: 'quoted',
    label: 'Quote sent',
    statuses: [CustomRequestStatus.QUOTED],
  },
  {
    key: 'accepted',
    label: 'Accepted',
    statuses: [CustomRequestStatus.ACCEPTED],
  },
  {
    key: 'closed',
    label: 'Closed',
    statuses: [CustomRequestStatus.DECLINED, CustomRequestStatus.CANCELLED],
  },
] as const;

const FLOW = FILTERS.flatMap((f) => f.statuses);

/** The kanban with no filter: the requests still open. */
const OPEN = [
  CustomRequestStatus.SUBMITTED,
  CustomRequestStatus.QUOTED,
  CustomRequestStatus.ACCEPTED,
];

const DEFAULTS = { filters: ['new'], sorts: ['createdAt', 'title'] };

const GROUPS = [{ key: 'status', label: 'Status' }];

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const state = listState(url.searchParams, DEFAULTS);
  const kanban = state.view === 'kanban';
  const picked = FILTERS.filter((f) => state.filters.includes(f.key)).flatMap(
    (f) => f.statuses,
  );
  const statuses = picked.length > 0 ? picked : kanban ? OPEN : [];
  const query = pageQuery(state, kanban ? 100 : 50);
  if (statuses.length > 0) query.set('statuses', statuses.join(','));
  const [r, counts] = await Promise.all([
    api.get<Page<CustomRequestListItem>>(`/custom-requests?${query}`),
    api.get<Partial<Record<CustomRequestStatus, number>>>(
      '/custom-requests/counts',
    ),
  ]);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  const count = counts.ok ? counts.data : {};
  return {
    state,
    requests: r.data,
    counts: count,
    total: state.q
      ? undefined
      : (statuses.length > 0 ? statuses : FLOW).reduce(
          (n, s) => n + (count[s] ?? 0),
          0,
        ),
    columns: kanban ? FLOW.filter((s) => statuses.includes(s)) : [],
  };
}

const status = (r: CustomRequestListItem) =>
  r.expired ? 'Quote expired' : CUSTOM_REQUEST_STATUS_LABELS[r.status].title;

const COLUMNS: ListColumn<CustomRequestListItem>[] = [
  { key: 'title', label: 'Request', sort: 'title', cell: (r) => r.title },
  {
    key: 'number',
    label: 'Number',
    cell: (r) => (
      <span className="font-mono whitespace-nowrap">{r.requestNumber}</span>
    ),
  },
  { key: 'customer', label: 'Customer', cell: (r) => r.customerEmail },
  { key: 'file', label: 'File', cell: (r) => (r.hasFile ? 'Attached' : '—') },
  { key: 'status', label: 'Status', cell: status },
  {
    key: 'quote',
    label: 'Quote',
    align: 'right',
    cell: (r) => (r.quotedPrice ? <Money amount={r.quotedPrice} /> : '—'),
  },
  {
    key: 'created',
    label: 'Sent',
    sort: 'createdAt',
    cell: (r) => (
      <span className="text-text-muted">{studioDate(r.createdAt)}</span>
    ),
  },
];

const href = (r: CustomRequestListItem) => `/admin/requests/${r.id}`;

export default function Requests({ loaderData }: Route.ComponentProps) {
  const { state, requests, counts, total, columns } = loaderData;
  return (
    <>
      <AdminHeader
        title="Custom requests"
        intro="What customers asked you to make. Designers add a design; staff send the quote, which the customer accepts to place the order."
      />
      <ControlPanel
        state={state}
        search="Number, title or email"
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
                shown: requests.items.length,
                total,
                nextCursor: requests.nextCursor,
              },
            }
          : {})}
      />
      {state.view === 'kanban' ? (
        <KanbanView
          href={href}
          columns={columns.map((s) => ({
            key: s,
            title: CUSTOM_REQUEST_STATUS_LABELS[s].title,
            items: requests.items.filter((r) => r.status === s),
          }))}
          title={(r) => r.title}
          card={(r) => (
            <>
              <span className="text-text-muted">
                {r.requestNumber} · {r.customerEmail}
              </span>
              {r.quotedPrice && <Money amount={r.quotedPrice} />}
              {r.expired && <span className="text-warning">Quote expired</span>}
            </>
          )}
        />
      ) : (
        <ListView
          label="Custom requests"
          rows={requests.items}
          columns={COLUMNS}
          href={href}
          state={state}
          empty="No requests here."
          group={(k) =>
            k === 'status'
              ? {
                  of: status,
                  order: FLOW.map((s) => CUSTOM_REQUEST_STATUS_LABELS[s].title),
                }
              : undefined
          }
        />
      )}
    </>
  );
}
