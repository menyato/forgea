import type { JournalEntryView } from '@forgea/types';
import { USD } from '~/components/money';
import { AdminHeader, Panel } from '~/features/admin/admin-ui';
import { EntryLines } from '~/features/accounting/entry-lines';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ params, context }: Route.LoaderArgs) {
  const r = await context
    .get(apiContext)
    .get<JournalEntryView>(
      `/accounting/entries/${encodeURIComponent(params.id)}`,
    );
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { entry: r.data };
}

const KIND: Record<JournalEntryView['type'], string> = {
  INVOICE: 'Invoice',
  CREDIT_NOTE: 'Credit note',
  PAYMENT: 'Payment',
  ENTRY: 'Manual entry',
};

/** One journal entry, read-only: a posted entry never changes (correct it with a new one). */
export default function EntryPage({ loaderData }: Route.ComponentProps) {
  const { entry: e } = loaderData;
  return (
    <>
      <AdminHeader
        trail={[{ label: 'Books', to: '/admin/accounting/books' }]}
        title={e.number || 'Draft entry'}
        intro={e.label}
      />
      <div className="grid gap-6">
        <Panel title={KIND[e.type]}>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
            <dt className="text-text-muted">Date</dt>
            <dd>{e.date}</dd>
            <dt className="text-text-muted">Journal</dt>
            <dd>
              <span className="mr-2 font-mono text-text-muted">
                {e.journal.code}
              </span>
              {e.journal.name}
            </dd>
            <dt className="text-text-muted">Customer</dt>
            <dd className="break-words">{e.customer?.email ?? 'None'}</dd>
            <dt className="text-text-muted">Order</dt>
            <dd className="font-mono">{e.orderNumber ?? 'None'}</dd>
            <dt className="text-text-muted">Currency</dt>
            <dd>
              {e.currencyCode}
              {e.currencyCode !== USD.code && ` (rate ${e.exchangeRate})`}
            </dd>
            {e.reversedEntryNumber && (
              <>
                <dt className="text-text-muted">Reverses</dt>
                <dd className="font-mono">{e.reversedEntryNumber}</dd>
              </>
            )}
          </dl>
        </Panel>
        <Panel title="Lines">
          <EntryLines entry={e} />
        </Panel>
      </div>
    </>
  );
}
