import type { StaffOrder } from '@forgea/types';
import { useState } from 'react';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { Field, SelectField } from '~/components/ui/field';
import { InvoiceTable } from '~/features/accounting/invoice-table';
import { useCan } from '~/features/admin/access';
import { Panel, SaveStatus } from '~/features/admin/admin-ui';
import type { SaveResult } from '~/features/admin/staff.server';

/**
 * The order's invoices. Usually made by the pipeline itself (deposit received, delivered);
 * these buttons cover the rest: an invoice missed (e.g. while the books were locked) and
 * payments collected another way. Each shows only to whoever may use it; the whole panel only to
 * whoever may see invoices (the API leaves them out for anyone else).
 */
export function InvoicesPanel({
  order: o,
  invoices: all,
}: {
  order: StaffOrder;
  invoices: NonNullable<StaffOrder['invoices']>;
}) {
  const fetcher = useFetcher<SaveResult>();
  const can = useCan();
  const invoices = all.filter((i) => i.type === 'INVOICE');
  const drafts = invoices.filter((i) => i.state === 'DRAFT');
  const posted = all.filter((i) => i.state === 'POSTED');
  const today = new Date().toISOString().slice(0, 10);
  const hasDeposit = invoices.some((i) => i.invoiceKind === 'DEPOSIT');
  const hasFinal = invoices.some((i) => i.invoiceKind === 'FINAL');
  // Invoices still owed, and credit notes whose money still goes back (a refund is their payment).
  const open = posted.filter((i) => Number(i.residual) > 0);
  // An invoice is credited once, in full; what the customer paid is then theirs to refund.
  const creditable = posted.filter(
    (i) => i.type === 'INVOICE' && !i.creditedBy,
  );
  const canDeposit = Number(o.depositRequired) > 0 && !hasDeposit;
  const [chosenId, setChosenId] = useState<string | null>(null);
  // The one chosen while it is still open; otherwise the first one open.
  const chosen = open.find((i) => i.id === chosenId) ?? open[0]!;
  return (
    <Panel title="Invoices">
      <InvoiceTable invoices={all} showOrder={false} />
      {can('invoices.create') && drafts.length > 0 && (
        <fetcher.Form
          method="post"
          className="flex flex-wrap items-end gap-3 border-t border-border pt-4"
        >
          <input type="hidden" name="intent" value="post-invoice" />
          <SelectField label="Draft to post" name="invoiceId">
            {drafts.map((i) => (
              <option key={i.id} value={i.id}>
                {i.invoiceKind === 'DEPOSIT' ? 'Deposit' : 'Invoice'} of{' '}
                {i.date} (${i.total}, due {i.dueDate ?? i.date})
              </option>
            ))}
          </SelectField>
          <Button type="submit" variant="secondary">
            Post it
          </Button>
          <p className="w-full text-xs text-text-muted">
            A draft has no number and stays out of the books. Change its dates
            or discard it from its page.
          </p>
        </fetcher.Form>
      )}
      {can('invoices.create') && (canDeposit || !hasFinal) && (
        <fetcher.Form
          method="post"
          className="grid gap-3 border-t border-border pt-4 sm:grid-cols-3 sm:items-end"
        >
          <SelectField
            label="Invoice"
            name="intent"
            defaultValue={canDeposit ? 'deposit-invoice' : 'final-invoice'}
          >
            {canDeposit && <option value="deposit-invoice">The deposit</option>}
            {!hasFinal && <option value="final-invoice">The order</option>}
          </SelectField>
          <Field
            label="Invoice date"
            name="invoiceDate"
            type="date"
            max={today}
            required
            defaultValue={today}
          />
          <Field
            label="Due date"
            name="dueDate"
            type="date"
            required
            defaultValue={today}
          />
          <div className="flex flex-wrap gap-2 sm:col-span-3">
            <Button type="submit" name="as" value="post">
              Post the invoice
            </Button>
            <Button type="submit" name="as" value="draft" variant="secondary">
              Save as a draft
            </Button>
          </div>
        </fetcher.Form>
      )}
      {open.length > 0 && can('payments.record') && (
        <fetcher.Form
          method="post"
          className="grid gap-3 border-t border-border pt-4 sm:grid-cols-4 sm:items-end"
        >
          <input type="hidden" name="intent" value="payment" />
          <SelectField
            label="Payment or refund for"
            name="invoiceId"
            value={chosen.id}
            onChange={(e) => setChosenId(e.currentTarget.value)}
          >
            {open.map((i) => (
              <option key={i.id} value={i.id}>
                {i.number}{' '}
                {i.type === 'CREDIT_NOTE'
                  ? `(refund $${i.residual})`
                  : `(owes $${i.residual})`}
              </option>
            ))}
          </SelectField>
          {/* Keyed: choosing another one fills in what is open on it. */}
          <Field
            key={`${chosen.id}-${chosen.residual}`}
            label="Amount (USD)"
            name="amount"
            inputMode="decimal"
            required
            defaultValue={chosen.residual}
          />
          <SelectField label="How" name="method" defaultValue="BANK">
            <option value="BANK">Money transfer</option>
            <option value="CASH">Cash</option>
          </SelectField>
          <Field
            label="Date"
            name="date"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
          <Button type="submit" className="sm:col-span-4 sm:justify-self-start">
            Record the payment
          </Button>
        </fetcher.Form>
      )}
      {creditable.length > 0 && can('books.manage') && (
        <fetcher.Form
          method="post"
          className="flex flex-wrap items-end gap-3 border-t border-border pt-4"
          onSubmit={(e) => {
            if (
              !window.confirm(
                'Issue a credit note? It cancels the whole invoice in the books and cannot be undone.',
              )
            )
              e.preventDefault();
          }}
        >
          <input type="hidden" name="intent" value="credit-note" />
          <SelectField label="Credit note for" name="invoiceId">
            {creditable.map((i) => (
              <option key={i.id} value={i.id}>
                {i.number} (${i.total})
              </option>
            ))}
          </SelectField>
          <Button type="submit" variant="secondary">
            Issue a credit note
          </Button>
        </fetcher.Form>
      )}
      <SaveStatus state={fetcher.state} result={fetcher.data} />
    </Panel>
  );
}
