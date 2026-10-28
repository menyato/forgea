import {
  type CheckoutResult,
  type CurrencyQuote,
  PAYMENT_METHOD_LABELS,
  type QuotationDetail,
  QuotationStatus,
} from '@forgea/types';
import {
  data,
  Form,
  redirect,
  useNavigation,
  useRouteLoaderData,
} from 'react-router';
import { PAGE_WIDTH } from '~/components/layout/page-width';
import { Money } from '~/components/money';
import { Button } from '~/components/ui/button';
import { signInFor } from '~/features/auth/sign-in-links.server';
import { WhatsAppLink } from '~/features/contact/whatsapp-link';
import { OrderConfirmation } from '~/features/orders/order-confirmation';
import { apiContext } from '~/lib/request.server';
import type { loader as rootLoader } from '~/root';
import type { Route } from './+types/route';

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: loaderData
        ? `Quotation ${loaderData.quotation.number} — Forgea`
        : 'Quotation — Forgea',
    },
    { name: 'robots', content: 'noindex' },
  ];
}

/** The link in the "quotation from Forgea" email; the customer's own quotations only. */
export async function loader({ params, url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  if (!api.hasSession) throw redirect(signInFor(url));
  const [q, currencies] = await Promise.all([
    api.get<QuotationDetail>(
      `/quotations/mine/${encodeURIComponent(params.number)}`,
    ),
    api.get<CurrencyQuote[]>('/currencies'),
  ]);
  if (q.status === 401) throw redirect(signInFor(url));
  if (!q.ok) throw new Response(q.message, { status: q.status });
  return {
    quotation: q.data,
    currencies: currencies.ok ? currencies.data : [],
  };
}

export async function action({ params, url, context }: Route.ActionArgs) {
  const r = await context
    .get(apiContext)
    .post<CheckoutResult>(
      `/quotations/mine/${encodeURIComponent(params.number)}/accept`,
    );
  if (r.status === 401) throw redirect(signInFor(url));
  return r.ok
    ? { result: r.data, error: null }
    : data({ result: null, error: r.message }, { status: r.status });
}

export default function QuotationPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { quotation: q, currencies } = loaderData;
  const store = useRouteLoaderData<typeof rootLoader>('root')?.store ?? null;
  const accepting = useNavigation().state === 'submitting';
  if (actionData?.result) {
    return (
      <OrderConfirmation
        result={actionData.result}
        currencies={currencies}
        store={store}
      />
    );
  }
  const open = q.status === QuotationStatus.SENT && !q.expired;
  return (
    <main className={`${PAGE_WIDTH} grid max-w-4xl gap-8 py-10`}>
      <header className="grid gap-2">
        <h1 className="font-display text-[clamp(2.25rem,4vw,3.5rem)] leading-none font-extrabold tracking-tight">
          Quotation {q.number}
        </h1>
        <p className="text-text-muted">
          {q.status === QuotationStatus.CONFIRMED
            ? `Accepted: order ${q.orderNumber}.`
            : q.status === QuotationStatus.CANCELLED
              ? 'This quotation was withdrawn.'
              : q.expired
                ? 'This quotation has expired. Ask us for a new date.'
                : `Valid until ${new Date(q.validUntil).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}.`}
        </p>
      </header>
      <div className="overflow-x-auto rounded-lg bg-surface p-5">
        <table className="w-full text-sm">
          <thead className="text-left text-text-muted">
            <tr>
              <th className="pb-2 pr-4 font-medium">What</th>
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
            <tr className="border-t border-border font-semibold">
              <td className="pt-3" colSpan={4}>
                Total (delivery added at the order if delivered)
              </td>
              <td className="pt-3 text-right">
                <Money amount={q.total} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {q.note && <p className="max-w-[65ch] whitespace-pre-line">{q.note}</p>}
      <p className="text-sm text-text-muted">
        {q.delivery
          ? `Delivered to ${q.addressLine}, ${q.city}.`
          : 'Picked up from the studio.'}{' '}
        Payment: {PAYMENT_METHOD_LABELS[q.paymentMethod].toLowerCase()}.
      </p>
      {actionData?.error && <p className="text-danger">{actionData.error}</p>}
      <div className="flex flex-wrap items-center gap-4">
        {open && (
          <Form method="post">
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
    </main>
  );
}
