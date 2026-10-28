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
    .get<Page<CustomRequestListItem>>(`/custom-requests?${query}`);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { requests: r.data };
}

export default function Requests({ loaderData }: Route.ComponentProps) {
  const { requests } = loaderData;
  const [params] = useSearchParams();
  const status = params.get('status');
  const tab = (s: CustomRequestStatus | null) => (s ? `?status=${s}` : '?');
  const more = new URLSearchParams(params);
  if (requests.nextCursor) more.set('cursor', requests.nextCursor);

  return (
    <>
      <AdminHeader
        title="Custom requests"
        intro="What customers asked you to make. Designers add a design; staff send the quote, which the customer accepts to place the order."
      />
      <nav aria-label="Request status" className="mb-6 flex flex-wrap gap-2">
        {[null, ...Object.values(CustomRequestStatus)].map((s) => (
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
            {s ? CUSTOM_REQUEST_STATUS_LABELS[s].title : 'All'}
          </Link>
        ))}
      </nav>
      {requests.items.length === 0 ? (
        <p className="text-text-muted">No requests here.</p>
      ) : (
        <ul className="grid gap-3">
          {requests.items.map((r) => (
            <li key={r.id}>
              <Link
                to={`/admin/requests/${r.id}`}
                className="grid gap-1 rounded-lg border border-border bg-surface p-4 hover:border-accent sm:grid-cols-[1fr_auto]"
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
  );
}
