import {
  CUSTOM_REQUEST_STATUS_LABELS,
  type CustomRequestView,
  type Page,
} from '@forgea/types';
import { Link, redirect } from 'react-router';
import { PAGE_WIDTH } from '~/components/layout/page-width';
import { Money } from '~/components/money';
import { buttonClass } from '~/components/ui/button';
import { signInFor } from '~/features/auth/sign-in-links.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export function meta(_: Route.MetaArgs) {
  return [{ title: 'My requests — Forgea' }];
}

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  if (!api.hasSession) throw redirect(signInFor(url));
  const r = await api.get<Page<CustomRequestView>>(
    '/custom-requests/mine?limit=50',
  );
  if (r.status === 401) throw redirect(signInFor(url));
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { requests: r.data.items };
}

export default function MyRequests({ loaderData }: Route.ComponentProps) {
  const { requests } = loaderData;
  return (
    <main className={`${PAGE_WIDTH} grid gap-8 py-10`}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-5xl font-extrabold tracking-tight">
          My requests
        </h1>
        <Link to="/custom" className={buttonClass()}>
          Send a new request
        </Link>
      </header>
      {requests.length === 0 ? (
        <p className="text-text-muted">
          Nothing yet. Describe what you need on the{' '}
          <Link to="/custom" className="underline underline-offset-4">
            custom order page
          </Link>{' '}
          and we will send you a quote.
        </p>
      ) : (
        <ul className="grid gap-3">
          {requests.map((r) => (
            <li key={r.requestNumber}>
              <Link
                to={`/requests/${r.requestNumber}`}
                className="grid gap-1 rounded-lg bg-surface p-5 hover:bg-surface-raised sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <span className="grid gap-0.5">
                  <span className="font-display text-xl font-bold">
                    {r.title}
                  </span>
                  <span className="text-sm text-text-muted">
                    {r.requestNumber}
                  </span>
                </span>
                <span className="text-sm sm:text-right">
                  <span className="font-semibold">
                    {r.expired
                      ? 'Quote expired'
                      : CUSTOM_REQUEST_STATUS_LABELS[r.status].title}
                  </span>
                  {r.quote && (
                    <span className="block text-text-muted">
                      <Money amount={r.quote.price} />
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
