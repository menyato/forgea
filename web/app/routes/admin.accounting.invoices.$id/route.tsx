import type { InvoiceListItem, JournalEntryView } from '@forgea/types';
import { InvoiceDatesDto } from '@forgea/validation';
import { data, Link, redirect, useFetcher } from 'react-router';
import { Money } from '~/components/money';
import { Button, buttonClass } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { EntryLines } from '~/features/accounting/entry-lines';
import { kindOf, numberOf, stateOf } from '~/features/accounting/invoice-table';
import { can, useCan } from '~/features/admin/access';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import {
  type SaveResult,
  save,
  staffContext,
  text,
} from '~/features/admin/staff.server';
import { StatusBar } from '~/features/admin/views';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';
import { studioToday } from '~/lib/studio-time';

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

/** A draft's dates | post it | discard it. */
export async function action({ request, params, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const intent = form.get('intent');
  const base = `/accounting/invoices/${encodeURIComponent(params.id)}`;
  if (intent === 'post' || intent === 'discard') {
    const r =
      intent === 'post'
        ? await api.post(`${base}/post`)
        : await api.delete(base);
    if (!r.ok)
      return data<SaveResult>({ error: r.message }, { status: r.status });
    if (intent === 'discard') {
      const orderId = text(form, 'orderId');
      throw redirect(
        orderId && /^[0-9a-f-]{36}$/.test(orderId)
          ? `/admin/orders/${orderId}`
          : '/admin/accounting',
      );
    }
    return data<SaveResult>({ ok: true });
  }
  return save(
    InvoiceDatesDto,
    { date: text(form, 'date'), dueDate: text(form, 'dueDate') },
    (dto) => api.put(`${base}/dates`, dto),
  );
}

/** An invoice's way to being paid; a credit note's to being refunded. */
const INVOICE_STEPS = [
  { key: 'Draft', label: 'Draft' },
  { key: 'Not paid', label: 'Not paid' },
  { key: 'Partly paid', label: 'Partly paid' },
  { key: 'Paid', label: 'Paid' },
];
const CREDIT_STEPS = [
  { key: 'To refund', label: 'To refund' },
  { key: 'Settled', label: 'Settled' },
];

/** An invoice or credit note: a draft's dates still change; posted ones never do. */
export default function InvoicePage({ loaderData }: Route.ComponentProps) {
  const { invoice: i, entry } = loaderData;
  const state = stateOf(i).label;
  const credit = i.type === 'CREDIT_NOTE';
  return (
    <>
      <AdminHeader
        trail={[{ label: 'Invoices', to: '/admin/accounting' }]}
        title={
          i.state === 'DRAFT' ? `Draft ${kindOf(i).toLowerCase()}` : i.number
        }
        intro={
          i.state === 'DRAFT'
            ? `${kindOf(i)} of ${i.date}${i.orderNumber ? ` for order ${i.orderNumber}` : ''}, not posted yet: it has no number and is not in the books. Posting it makes it final.`
            : `${kindOf(i)} of ${i.date}${i.orderNumber ? ` for order ${i.orderNumber}` : ''}. Posted entries never change: payments, refunds and credit notes are recorded from the order's page.`
        }
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
            <dd className="font-mono">{numberOf(i)}</dd>
            <dt className="text-text-muted">Invoice date</dt>
            <dd>{i.date}</dd>
            <dt className="text-text-muted">Due date</dt>
            <dd>{i.dueDate ?? i.date}</dd>
            <dt className="text-text-muted">Status</dt>
            <dd>{i.state === 'DRAFT' ? 'Draft' : 'Posted'}</dd>
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
        {i.state === 'DRAFT' && <DraftActions invoice={i} />}
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

/** A draft's dates, and posting or discarding it (for whoever makes invoices). */
function DraftActions({ invoice: i }: { invoice: InvoiceListItem }) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  if (!useCan()('invoices.create')) return null;
  return (
    <Panel title="Draft" className="lg:col-span-2">
      <fetcher.Form
        method="post"
        className="grid gap-3 sm:grid-cols-3 sm:items-end"
      >
        <input type="hidden" name="intent" value="dates" />
        <Field
          label="Invoice date"
          name="date"
          type="date"
          required
          max={studioToday()}
          defaultValue={i.date}
          error={errors['date']}
        />
        <Field
          label="Due date"
          name="dueDate"
          type="date"
          required
          defaultValue={i.dueDate ?? i.date}
          error={errors['dueDate']}
        />
        <Button type="submit" variant="secondary">
          Save the dates
        </Button>
      </fetcher.Form>
      <fetcher.Form method="post" className="flex flex-wrap gap-2">
        <input type="hidden" name="orderId" value={i.orderId ?? ''} />
        <Button type="submit" name="intent" value="post">
          Post it
        </Button>
        <Button
          type="submit"
          name="intent"
          value="discard"
          variant="quiet"
          onClick={(e) => {
            if (!window.confirm('Discard this draft invoice?'))
              e.preventDefault();
          }}
        >
          Discard the draft
        </Button>
      </fetcher.Form>
      <SaveStatus state={fetcher.state} result={fetcher.data} />
    </Panel>
  );
}
