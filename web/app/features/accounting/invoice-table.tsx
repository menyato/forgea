import type { InvoiceListItem, PaymentState } from '@forgea/types';
import { Money } from '~/components/money';

const STATE_LABELS: Record<PaymentState, { label: string; tone: string }> = {
  not_paid: { label: 'Not paid', tone: 'text-warning' },
  partial: { label: 'Partly paid', tone: 'text-warning' },
  paid: { label: 'Paid', tone: 'text-success' },
  reversed: { label: 'Credited', tone: 'text-text-muted' },
};

/** A credit note's open amount is money to give back, not money owed. */
export function stateOf(i: InvoiceListItem) {
  if (i.type !== 'CREDIT_NOTE') return STATE_LABELS[i.paymentState];
  return Number(i.residual) > 0
    ? { label: 'To refund', tone: 'text-warning' }
    : { label: 'Settled', tone: 'text-text-muted' };
}

/** "Credit note", "Deposit" or "Invoice". */
export const kindOf = (i: InvoiceListItem) =>
  i.type === 'CREDIT_NOTE'
    ? 'Credit note'
    : i.invoiceKind === 'DEPOSIT'
      ? 'Deposit'
      : 'Invoice';

/** Invoices and credit notes with what is still owed (the accounting page and an order). */
export function InvoiceTable({
  invoices,
  showOrder = true,
}: {
  invoices: readonly InvoiceListItem[];
  showOrder?: boolean;
}) {
  if (invoices.length === 0)
    return <p className="text-sm text-text-muted">No invoices yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-text-muted">
          <tr>
            <th className="py-2 pr-4 font-medium">Number</th>
            <th className="py-2 pr-4 font-medium">Date</th>
            {showOrder && <th className="py-2 pr-4 font-medium">Order</th>}
            <th className="py-2 pr-4 font-medium">Customer</th>
            <th className="py-2 pr-4 text-right font-medium">Total</th>
            <th className="py-2 pr-4 text-right font-medium">Still owed</th>
            <th className="py-2 font-medium">State</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((i) => (
            <tr key={i.id} className="border-t border-border">
              <td className="py-2 pr-4 font-mono">
                {i.number}
                <span className="block font-sans text-xs text-text-muted">
                  {kindOf(i)}
                </span>
              </td>
              <td className="py-2 pr-4">{i.date}</td>
              {showOrder && (
                <td className="py-2 pr-4 font-mono">{i.orderNumber ?? ''}</td>
              )}
              <td className="py-2 pr-4">
                {i.customer?.name ?? i.customer?.email ?? ''}
              </td>
              <td className="py-2 pr-4 text-right">
                <Money amount={i.total} />
              </td>
              <td className="py-2 pr-4 text-right">
                <Money amount={i.residual} />
              </td>
              <td className={`py-2 ${stateOf(i).tone}`}>
                {stateOf(i).label}
                {i.creditedBy && (
                  <span className="block text-xs text-text-muted">
                    credited by {i.creditedBy}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
