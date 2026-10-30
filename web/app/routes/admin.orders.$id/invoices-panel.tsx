import type { StaffOrder } from '@forgea/types';
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
  const hasDeposit = invoices.some((i) => i.invoiceKind === 'DEPOSIT');
  const hasFinal = invoices.some((i) => i.invoiceKind === 'FINAL');
  const open = invoices.filter((i) => Number(i.residual) > 0);
  return (
    <Panel title="Invoices">
      <InvoiceTable invoices={all} showOrder={false} />
      {can('invoices.create') && (
        <fetcher.Form method="post" className="flex flex-wrap gap-2">
          {Number(o.depositRequired) > 0 && !hasDeposit && (
            <Button
              type="submit"
              name="intent"
              value="deposit-invoice"
              variant="secondary"
            >
              Invoice the deposit
            </Button>
          )}
          {!hasFinal && (
            <Button
              type="submit"
              name="intent"
              value="final-invoice"
              variant="secondary"
            >
              Invoice the order
            </Button>
          )}
        </fetcher.Form>
      )}
      {open.length > 0 && can('payments.record') && (
        <fetcher.Form
          method="post"
          className="grid gap-3 border-t border-border pt-4 sm:grid-cols-4 sm:items-end"
        >
          <input type="hidden" name="intent" value="payment" />
          <SelectField label="Payment for" name="invoiceId">
            {open.map((i) => (
              <option key={i.id} value={i.id}>
                {i.number} (owes ${i.residual})
              </option>
            ))}
          </SelectField>
          <Field
            label="Amount (USD)"
            name="amount"
            inputMode="decimal"
            required
            defaultValue={open[0]!.residual}
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
      <SaveStatus state={fetcher.state} result={fetcher.data} />
    </Panel>
  );
}
