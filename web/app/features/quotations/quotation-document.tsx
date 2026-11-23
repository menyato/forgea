import {
  type CheckoutResult,
  type CurrencyQuote,
  formatSizeCm,
  PAYMENT_METHOD_LABELS,
  type QuotationDetail,
  QuotationStatus,
} from '@forgea/types';
import { Form, useNavigation, useRouteLoaderData } from 'react-router';
import { PAGE_WIDTH } from '~/components/layout/page-width';
import { Money } from '~/components/money';
import { Button } from '~/components/ui/button';
import { WhatsAppLink } from '~/features/contact/whatsapp-link';
import { OrderConfirmation } from '~/features/orders/order-confirmation';
import type { loader as rootLoader } from '~/root';

/**
 * A quotation as the customer reads it — on their account page or from the emailed link:
 * every line with its printed size, delivery, the amount to pay, and the accept button (or
 * declining it, with a reason if they like).
 */
export function QuotationDocument({
  quotation: q,
  deliveryFee,
  currencies,
  result,
  error,
  signInNote,
}: {
  quotation: QuotationDetail;
  deliveryFee: string | null;
  currencies: CurrencyQuote[];
  result: CheckoutResult | null | undefined;
  error: string | null | undefined;
  /** Shown under the button when accepting needs an account first. */
  signInNote?: string | undefined;
}) {
  const store = useRouteLoaderData<typeof rootLoader>('root')?.store ?? null;
  const accepting = useNavigation().state === 'submitting';
  if (result) {
    return (
      <OrderConfirmation
        result={result}
        currencies={currencies}
        store={store}
      />
    );
  }
  const open = q.status === QuotationStatus.SENT && !q.expired;
  const toPay = (Number(q.total) + Number(deliveryFee ?? 0)).toFixed(2);
  return (
    <main className={`${PAGE_WIDTH} grid max-w-4xl gap-8 py-10`}>
      <header className="grid gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-text-muted">
          Quotation for {q.customerName}
        </p>
        <h1 className="font-display text-[clamp(2.25rem,4vw,3.5rem)] leading-none font-extrabold tracking-tight">
          Quotation {q.number}
        </h1>
        <p className="text-text-muted">
          {q.status === QuotationStatus.CONFIRMED
            ? `Accepted: order ${q.orderNumber}.`
            : q.status === QuotationStatus.CANCELLED
              ? 'This quotation was withdrawn.'
              : q.status === QuotationStatus.DECLINED
                ? 'You declined this quotation. Thank you for letting us know; we may send you a new one.'
                : q.expired
                  ? 'This quotation has expired. Ask us for a new date.'
                  : `Valid until ${new Date(q.validUntil).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}.`}
        </p>
      </header>
      <div className="overflow-x-auto rounded-lg bg-surface p-5">
        <table className="w-full text-sm">
          <thead className="text-left text-text-muted">
            <tr>
              <th className="pb-2 pr-4 font-medium">What</th>
              <th className="pb-2 pr-4 font-medium">
                Size <span className="font-normal">(W × D × H)</span>
              </th>
              <th className="pb-2 pr-4 text-right font-medium">Qty</th>
              <th className="pb-2 pr-4 text-right font-medium">Unit price</th>
              <th className="pb-2 pr-4 text-right font-medium">Discount</th>
              <th className="pb-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {q.lines.map((l) => (
              <tr key={l.id} className="border-t border-border">
                <td className="py-2 pr-4">
                  {l.description}
                  {l.isCustom && (
                    <span className="ml-2 text-xs text-text-muted">
                      made to order
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  {l.size ? formatSizeCm(l.size) : '—'}
                </td>
                <td className="py-2 pr-4 text-right">{l.quantity}</td>
                <td className="py-2 pr-4 text-right">
                  <Money amount={l.unitPrice} />
                </td>
                <td className="py-2 pr-4 text-right">
                  {Number(l.discountPercent) > 0
                    ? `${Number(l.discountPercent)}%`
                    : ''}
                </td>
                <td className="py-2 text-right">
                  <Money amount={l.lineTotal} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {deliveryFee !== null && Number(deliveryFee) > 0 && (
              <tr className="border-t border-border">
                <td className="pt-3" colSpan={5}>
                  Delivery
                </td>
                <td className="pt-3 text-right">
                  <Money amount={deliveryFee} />
                </td>
              </tr>
            )}
            <tr className="border-t border-border font-semibold">
              <td className="pt-3" colSpan={5}>
                To pay
              </td>
              <td className="pt-3 text-right">
                <Money amount={toPay} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {q.note && <p className="max-w-[65ch] whitespace-pre-line">{q.note}</p>}
      <p className="text-sm text-text-muted">
        {q.delivery
          ? `Delivered to ${q.addressLine}, ${q.city}.`
          : 'Picked up from Forgea Lab.'}{' '}
        Payment: {PAYMENT_METHOD_LABELS[q.paymentMethod].toLowerCase()}.
      </p>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        {open && (
          <Form method="post">
            <input type="hidden" name="seen" value={q.version} />
            <Button
              type="submit"
              disabled={accepting}
              className="px-6 py-3 text-base"
            >
              {accepting ? 'Placing the order…' : 'Accept and place the order'}
            </Button>
          </Form>
        )}
        {store && (
          <WhatsAppLink
            phone={store.whatsappPhone}
            message={`Hello Forgea! About quotation ${q.number}.`}
            className="text-sm underline underline-offset-4"
          >
            Questions? Ask us on WhatsApp
          </WhatsAppLink>
        )}
      </div>
      {open && signInNote && (
        <p className="text-sm text-text-muted">{signInNote}</p>
      )}
      {open && (
        <details className="grid gap-3 text-sm">
          <summary className="cursor-pointer text-text-muted underline underline-offset-4">
            Not right for you? Decline it
          </summary>
          <Form method="post" className="mt-3 grid max-w-xl gap-3">
            <input type="hidden" name="intent" value="decline" />
            <label className="grid gap-1.5">
              <span className="font-medium">Why not? (optional)</span>
              <textarea
                name="reason"
                maxLength={500}
                rows={3}
                className="rounded-md border border-border bg-bg px-3 py-2"
              />
            </label>
            <Button
              type="submit"
              variant="secondary"
              disabled={accepting}
              className="justify-self-start"
            >
              Decline this quotation
            </Button>
          </Form>
        </details>
      )}
    </main>
  );
}
