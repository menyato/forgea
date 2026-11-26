import type { CustomRequestView, StaffCustomRequest } from '@forgea/types';
import { Link, useRouteLoaderData } from 'react-router';
import { RequestForCustomer } from '~/features/custom-requests/request-for-customer';
import { apiContext } from '~/lib/request.server';
import type { loader as rootLoader } from '~/root';
import type { Route } from './+types/route';

/**
 * A request as its customer sees it, opened from the dashboard: the same page as theirs (our
 * design in 3D, the quote, the history), without their buttons.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const r = await api.get<StaffCustomRequest>(
    `/custom-requests/${encodeURIComponent(params.id)}`,
  );
  if (!r.ok) throw new Response(r.message, { status: r.status });
  // Only what the customer's own page gets.
  const { id, customer, printFigures, ...theirs } = r.data;
  const request: CustomRequestView = theirs;
  return { id, customer: customer.name ?? customer.email, request };
}

export default function RequestPreview({ loaderData }: Route.ComponentProps) {
  const { id, customer, request } = loaderData;
  const store = useRouteLoaderData<typeof rootLoader>('root')?.store ?? null;
  return (
    <div className="grid gap-2">
      <p
        role="note"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-4 text-sm"
      >
        <span>
          What <strong>{customer}</strong> sees on their request page. Their
          buttons (accept, decline) are left out here.
        </span>
        <Link
          to={`/admin/requests/${id}`}
          className="underline underline-offset-4"
        >
          Back to the request
        </Link>
      </p>
      <RequestForCustomer request={request} store={store} />
    </div>
  );
}
