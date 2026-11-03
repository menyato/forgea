import type { AuditLogEntry, AuditLogListItem, Page } from '@forgea/types';
import { Link } from 'react-router';
import { AdminHeader, Panel } from '~/features/admin/admin-ui';
import { auditTime, recordPage } from '~/features/admin/audit-links';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ params, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const r = await api.get<AuditLogEntry>(
    `/audit-log/${encodeURIComponent(params.id)}`,
  );
  if (!r.ok) throw new Response(r.message, { status: r.status });
  const e = r.data;
  // The same record's latest entries ("new" names no record of its own).
  const same =
    e.targetId === 'new'
      ? null
      : await api.get<Page<AuditLogListItem>>(
          `/audit-log?${new URLSearchParams({ targetType: e.targetType, targetId: e.targetId, limit: '20' })}`,
        );
  return { entry: e, others: same?.ok ? same.data.items : [] };
}

/** One audit entry: who did what to which record, when, from where, and what it recorded. */
export default function AuditEntry({ loaderData }: Route.ComponentProps) {
  const { entry: e, others } = loaderData;
  const record = recordPage(e.targetType, e.targetId);
  return (
    <>
      <AdminHeader
        title={e.action}
        intro={`${e.actor?.email ?? 'System'} · ${auditTime(e.timestamp)}`}
        trail={[{ label: 'Audit log', to: '/admin/audit' }]}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="Entry">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <dt className="text-text-muted">When</dt>
            <dd>{auditTime(e.timestamp)} (Beirut time)</dd>
            <dt className="text-text-muted">Who</dt>
            <dd>{e.actor?.email ?? 'System'}</dd>
            <dt className="text-text-muted">Action</dt>
            <dd className="font-mono text-xs">{e.action}</dd>
            <dt className="text-text-muted">Record</dt>
            <dd>
              {e.targetType}{' '}
              {record ? (
                <Link
                  to={record}
                  className="break-all font-mono text-xs underline underline-offset-4"
                >
                  {e.targetId}
                </Link>
              ) : (
                <span className="break-all font-mono text-xs">
                  {e.targetId}
                </span>
              )}
            </dd>
            <dt className="text-text-muted">From</dt>
            <dd>{e.ipAddress ?? 'Not recorded'}</dd>
          </dl>
          <h3 className="text-sm font-semibold">Recorded</h3>
          {e.metadata === null ? (
            <p className="text-sm text-text-muted">Nothing more.</p>
          ) : (
            <pre className="max-h-[28rem] overflow-auto rounded-md bg-background p-3 font-mono text-xs whitespace-pre-wrap break-all">
              {JSON.stringify(e.metadata, null, 2)}
            </pre>
          )}
        </Panel>
        <Panel title="This record's entries">
          {others.length === 0 ? (
            <p className="text-sm text-text-muted">No others.</p>
          ) : (
            <ol className="grid gap-2 text-sm">
              {others.map((o) => (
                <li key={o.id}>
                  {o.id === e.id ? (
                    <span aria-current="true" className="font-semibold">
                      {o.action}
                    </span>
                  ) : (
                    <Link
                      to={`/admin/audit/${o.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {o.action}
                    </Link>
                  )}
                  <span className="block text-xs text-text-muted">
                    {auditTime(o.timestamp)} · {o.actor?.email ?? 'System'}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </>
  );
}
