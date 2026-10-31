import {
  CUSTOM_REQUEST_STATUS_LABELS,
  type CustomRequestListItem,
  CustomRequestStatus,
  type Page,
} from '@forgea/types';
import { Link, useSearchParams } from 'react-router';
import { Money } from '~/components/money';
import { buttonClass } from '~/components/ui/button';
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

/** The tabs: new requests first, then those waiting on the customer, then the rest. */
const TABS = [
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
  { key: 'all', label: 'All', statuses: [] },
] as const;

const BOARD = [
  CustomRequestStatus.SUBMITTED,
  CustomRequestStatus.QUOTED,
  CustomRequestStatus.ACCEPTED,
] as const;

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const board = viewMode(url.searchParams) === 'board';
  const tab =
    TABS.find((t) => t.key === url.searchParams.get('tab')) ?? TABS[0];
  const query = new URLSearchParams({ limit: board ? '100' : '50' });
  const statuses = board ? BOARD : tab.statuses;
  if (statuses.length > 0) query.set('statuses', statuses.join(','));
  const cursor = url.searchParams.get('cursor');
  if (cursor) query.set('cursor', cursor);
  const [r, counts] = await Promise.all([
    api.get<Page<CustomRequestListItem>>(`/custom-requests?${query}`),
    api.get<Partial<Record<CustomRequestStatus, number>>>(
      '/custom-requests/counts',
    ),
  ]);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return {
    requests: r.data,
    tab: tab.key,
    counts: counts.ok ? counts.data : {},
  };
}

export default function Requests({ loaderData }: Route.ComponentProps) {
  const { requests, tab, counts } = loaderData;
  const [params] = useSearchParams();
  const mode = viewMode(params);
  const more = new URLSearchParams(params);
  if (requests.nextCursor) more.set('cursor', requests.nextCursor);

  return (
    <>
      <AdminHeader
        title="Custom requests"
        intro="What customers asked you to make. Designers add a design; staff send the quote, which the customer accepts to place the order."
        action={<ViewSwitch current={mode} />}
      />
      {mode === 'board' ? (
        <Board
          columns={BOARD.map((s) => ({
            key: s,
            title: CUSTOM_REQUEST_STATUS_LABELS[s].title,
            items: requests.items.filter((r) => r.status === s),
          }))}
          card={(r) => (
            <BoardCard to={`/admin/requests/${r.id}`} title={r.title}>
              <span className="text-text-muted">
                {r.requestNumber} · {r.customerEmail}
              </span>
              {r.quotedPrice && <Money amount={r.quotedPrice} />}
              {r.expired && <span className="text-warning">Quote expired</span>}
            </BoardCard>
          )}
        />
      ) : (
        <>
          <ViewTabs
            label="Request groups"
            current={tab}
            tabs={TABS.map((t) => ({
              key: t.key,
              label: t.label,
              ...(t.key === 'new' || t.key === 'quoted' || t.key === 'accepted'
                ? {
                    count: t.statuses.reduce((n, s) => n + (counts[s] ?? 0), 0),
                  }
                : {}),
            }))}
          />
          {requests.items.length === 0 ? (
            <p className="text-text-muted">No requests here.</p>
          ) : (
            <ul className="grid gap-3">
              {requests.items.map((r) => (
                <li key={r.id}>
                  <Link
                    to={`/admin/requests/${r.id}`}
                    className="grid gap-1 rounded-lg border border-border bg-surface p-4 hover:border-accent sm:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <span>
                      <span className="font-semibold">{r.title}</span>
                      <span className="block text-sm text-text-muted">
                        {r.requestNumber} · {r.customerEmail}
                        {r.hasFile && ' · file attached'}
                      </span>
                    </span>
                    <span className="text-sm sm:text-right">
                      {r.expired
                        ? 'Quote expired'
                        : CUSTOM_REQUEST_STATUS_LABELS[r.status].title}
                      {r.quotedPrice && (
                        <span className="block text-text-muted">
                          <Money amount={r.quotedPrice} />
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {requests.hasMore && (
            <Link to={`?${more}`} className={buttonClass('secondary', 'mt-4')}>
              Next page
            </Link>
          )}
        </>
      )}
    </>
  );
}
