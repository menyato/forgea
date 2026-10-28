import type { AuditLogListItem, Page } from '@forgea/types';
import { Form, Link, useSearchParams } from 'react-router';
import { buttonClass } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { AdminHeader } from '~/features/admin/admin-ui';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ url, context }: Route.LoaderArgs) {
  const query = new URLSearchParams({ limit: '100' });
  for (const key of ['action', 'targetType', 'cursor'] as const) {
    const v = url.searchParams.get(key)?.trim();
    if (v) query.set(key, v);
  }
  // Dates from the form are days; the API takes timestamps.
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (from) query.set('from', new Date(`${from}T00:00:00Z`).toISOString());
  if (to) query.set('to', new Date(`${to}T23:59:59.999Z`).toISOString());
  const r = await context
    .get(apiContext)
    .get<Page<AuditLogListItem>>(`/audit-log?${query}`);
  if (!r.ok) {
    // A filter the API refuses (e.g. a malformed action) is shown, not an error page.
    if (r.status === 400) return { entries: null, message: r.message };
    throw new Response(r.message, { status: r.status });
  }
  return { entries: r.data, message: null };
}

export default function Audit({ loaderData }: Route.ComponentProps) {
  const { entries, message } = loaderData;
  const [params] = useSearchParams();
  const more = new URLSearchParams(params);
  if (entries?.nextCursor) more.set('cursor', entries.nextCursor);
  return (
    <>
      <AdminHeader
        title="Audit log"
        intro="Every sensitive change and every team sign-in: who, what, when and from where. Entries can't be edited or deleted."
      />
      <Form
        method="get"
        className="mb-6 grid gap-3 sm:grid-cols-5 sm:items-end"
      >
        <Field
          label="Action"
          name="action"
          defaultValue={params.get('action') ?? ''}
          hint="e.g. order.status.change"
        />
        <Field
          label="What"
          name="targetType"
          defaultValue={params.get('targetType') ?? ''}
          hint="e.g. Order, Product"
        />
        <Field
          label="From"
          name="from"
          type="date"
          defaultValue={params.get('from') ?? ''}
        />
        <Field
          label="To"
          name="to"
          type="date"
          defaultValue={params.get('to') ?? ''}
        />
        <button type="submit" className={buttonClass('secondary')}>
          Filter
        </button>
      </Form>
      {message && <p className="text-danger">{message}</p>}
      {entries && (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="text-left text-text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Who</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">What</th>
                <th className="px-4 py-3 font-medium">From</th>
              </tr>
            </thead>
            <tbody>
              {entries.items.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="whitespace-nowrap px-4 py-2">
                    {new Date(e.timestamp).toLocaleString('en-GB')}
                  </td>
                  <td className="px-4 py-2">{e.actor?.email ?? 'System'}</td>
                  <td className="px-4 py-2 font-mono text-xs">{e.action}</td>
                  <td className="px-4 py-2">
                    {e.targetType}{' '}
                    <span className="font-mono text-xs text-text-muted">
                      {e.targetId}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-text-muted">
                    {e.ipAddress ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {entries?.hasMore && (
        <Link to={`?${more}`} className={buttonClass('secondary', 'mt-4')}>
          Older entries
        </Link>
      )}
    </>
  );
}
