import type { AuditLogListItem, Page } from '@forgea/types';
import { AdminHeader } from '~/features/admin/admin-ui';
import { auditTime } from '~/features/admin/audit-links';
import { listState } from '~/features/admin/list-state';
import {
  ControlPanel,
  type ListColumn,
  type ListFilter,
  ListView,
} from '~/features/admin/views';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';
import { studioToday } from '~/lib/studio-time';

const DEFAULTS = { sorts: ['timestamp'] } as const;
const DAY_MS = 86_400_000;

/** How far back to look (one at a time). */
const PERIODS = [
  { key: 'today', label: 'Today', days: 0 },
  { key: 'week', label: 'Last 7 days', days: 7 },
  { key: 'month', label: 'Last 30 days', days: 30 },
] as const;

/** Shortcuts to the records most often looked up; any other type can be searched by name. */
const TYPES = [
  { key: 'Order', label: 'Orders' },
  { key: 'Invoice', label: 'Invoices' },
  { key: 'Quotation', label: 'Quotations' },
  { key: 'PrintJob', label: 'Print runs' },
  { key: 'Product', label: 'Products' },
  { key: 'User', label: 'Team and sign-ins' },
] as const;

const FILTERS: ListFilter[] = [
  ...PERIODS.map((p) => ({ key: p.key, label: p.label, only: 'period' })),
  ...TYPES.map((t) => ({ key: t.key, label: t.label, only: 'type' })),
];

/**
 * The search box holds an action ("order.status.change", it has a dot) or a record type
 * ("Order", "PrintJob"): the API matches either exactly.
 */
function searchTerms(q: string): Record<string, string> {
  if (q.includes('.')) return { action: q.toLowerCase() };
  return { targetType: q.charAt(0).toUpperCase() + q.slice(1) };
}

export async function loader({ url, context }: Route.LoaderArgs) {
  const state = listState(url.searchParams, DEFAULTS);
  const query = new URLSearchParams({
    limit: '100',
    sort: state.sort,
    order: state.order,
  });
  if (state.cursor) query.set('cursor', state.cursor);
  const period = PERIODS.find((p) => state.filters.includes(p.key));
  if (period) {
    const today = new Date(studioToday());
    query.set(
      'from',
      new Date(today.getTime() - period.days * DAY_MS).toISOString(),
    );
  }
  const type = TYPES.find((t) => state.filters.includes(t.key));
  if (type) query.set('targetType', type.key);
  if (state.q) {
    for (const [k, v] of Object.entries(searchTerms(state.q))) query.set(k, v);
  }
  const r = await context
    .get(apiContext)
    .get<Page<AuditLogListItem>>(`/audit-log?${query}`);
  if (!r.ok) {
    // A search the API refuses (e.g. a malformed action) is shown, not an error page.
    if (r.status === 400)
      return {
        state,
        entries: null,
        message:
          'Search for an action such as order.status.change, or a record type such as Order.',
      };
    throw new Response(r.message, { status: r.status });
  }
  return { state, entries: r.data, message: null };
}

const COLUMNS: ListColumn<AuditLogListItem>[] = [
  {
    key: 'when',
    label: 'When',
    sort: 'timestamp',
    cell: (e) => (
      <span className="whitespace-nowrap">{auditTime(e.timestamp)}</span>
    ),
  },
  { key: 'who', label: 'Who', cell: (e) => e.actor?.email ?? 'System' },
  {
    key: 'action',
    label: 'Action',
    cell: (e) => <span className="font-mono text-xs">{e.action}</span>,
  },
  {
    key: 'what',
    label: 'What',
    cell: (e) => (
      <>
        {e.targetType}{' '}
        <span className="break-all font-mono text-xs text-text-muted">
          {e.targetId}
        </span>
      </>
    ),
  },
  {
    key: 'from',
    label: 'From',
    cell: (e) => <span className="text-text-muted">{e.ipAddress ?? ''}</span>,
  },
];

export default function Audit({ loaderData }: Route.ComponentProps) {
  const { state, entries, message } = loaderData;
  return (
    <>
      <AdminHeader
        title="Audit log"
        intro="Every sensitive change and every team sign-in: who, what, when (Beirut time) and from where. Open one for what it recorded. Entries can't be edited or deleted."
      />
      <ControlPanel
        state={state}
        search="Action (order.status.change) or record type (Order)"
        filters={FILTERS}
        {...(entries
          ? {
              page: {
                shown: entries.items.length,
                nextCursor: entries.nextCursor,
              },
            }
          : {})}
      />
      {message && <p className="text-danger">{message}</p>}
      {entries && (
        <ListView
          label="Audit log"
          rows={entries.items}
          columns={COLUMNS}
          href={(e) => `/admin/audit/${e.id}`}
          state={state}
          empty="Nothing recorded here."
        />
      )}
    </>
  );
}
