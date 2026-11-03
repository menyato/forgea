import type { InvoiceListItem, JournalEntryView } from '@forgea/types';
import { Link } from 'react-router';
import { Money } from '~/components/money';
import { buttonClass } from '~/components/ui/button';
import { EntryLines } from '~/features/accounting/entry-lines';
import { kindOf, stateOf } from '~/features/accounting/invoice-table';
import { can } from '~/features/admin/access';
import { AdminHeader, Panel } from '~/features/admin/admin-ui';
import { staffContext } from '~/features/admin/staff.server';
import { StatusBar } from '~/features/admin/views';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ params, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const id = encodeURIComponent(params.id);
  const books = can(context.get(staffContext), 'books.view');
  const [invoice, entry] = await Promise.all([
    api.get<InvoiceListItem>(`/accounting/invoices/${id}`),
    // Its journal lines, for those who may see the books.
    books ? api.get<JournalEntryView>(`/accounting/entries/${id}`) : null,
  ]);
  if (!invoice.ok)
    throw new Response(invoice.message, { status: invoice.status });
  return { invoice: invoice.data, entry: entry?.ok ? entry.data : null };
}

/** An invoice's way to being paid; a credit note's to being refunded. */
const INVOICE_STEPS = [
  { key: 'Not paid', label: 'Not paid' },
  { key: 'Partly paid', label: 'Partly paid' },
  { key: 'Paid', label: 'Paid' },
];
const CREDIT_STEPS = [
  { key: 'To refund', label: 'To refund' },
  { key: 'Settled', label: 'Settled' },
];

/** An invoice or credit note, read-only: posted entries never change. */
export default function InvoicePage({ loaderData }: Route.ComponentProps) {
  const { invoice: i, entry } = loaderData;
  const state = stateOf(i).label;
  const credit = i.type === 'CREDIT_NOTE';
  return (
    <>
      <AdminHeader
        trail={[{ label: 'Invoices', to: '/admin/accounting' }]}
        title={i.number}
        intro={`${kindOf(i)} of ${i.date}${i.orderNumber ? ` for order ${i.orderNumber}` : ''}. Posted entries never change: payments, refunds and credit notes are recorded from the order's page.`}
        action={
          i.orderId ? (
            <Link
              to={`/admin/orders/${i.orderId}`}
              className={buttonClass('secondary')}
            >
              Open the order
            </Link>
          ) : undefined
        }
      />
      <StatusBar
        steps={credit ? CREDIT_STEPS : INVOICE_STEPS}
        current={state}
        aside={state === 'Credited' ? 'Credited' : undefined}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={kindOf(i)}>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
            <dt className="text-text-muted">Number</dt>
            <dd className="font-mono">{i.number}</dd>
            <dt className="text-text-muted">Date</dt>
            <dd>{i.date}</dd>
            <dt className="text-text-muted">Customer</dt>
            <dd className="break-words">
              {i.customer
                ? `${i.customer.name ? `${i.customer.name} · ` : ''}${i.customer.email}`
                : 'None'}
            </dd>
            <dt className="text-text-muted">Order</dt>
            <dd className="font-mono">{i.orderNumber ?? 'None'}</dd>
            <dt className="text-text-muted">Currency</dt>
            <dd>{i.currencyCode}</dd>
            {i.creditedBy && (
              <>
                <dt className="text-text-muted">Credited by</dt>
                <dd className="font-mono">{i.creditedBy}</dd>
              </>
            )}
          </dl>
        </Panel>
        <Panel title="Amounts">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
            <dt className="text-text-muted">Total</dt>
            <dd className="text-right">
              <Money amount={i.total} />
            </dd>
            <dt className="text-text-muted">
              {credit ? 'Still to refund' : 'Still owed'}
            </dt>
            <dd className="text-right">
              <Money amount={i.residual} />
            </dd>
            <dt className="text-text-muted">State</dt>
            <dd className={`text-right ${stateOf(i).tone}`}>{state}</dd>
          </dl>
        </Panel>
        {entry && (
          <Panel title="Journal entry" className="lg:col-span-2">
            <EntryLines entry={entry} />
            <Link
              to={`/admin/accounting/books/entries/${entry.id}`}
              className="justify-self-start text-sm underline"
            >
              Open the entry in the books
            </Link>
          </Panel>
        )}
      </div>
    </>
  );
}
