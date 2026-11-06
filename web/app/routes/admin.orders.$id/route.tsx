import {
  ORDER_STATUS_LABELS,
  OrderStatus,
  type Page,
  PAYMENT_METHOD_LABELS,
  type PrintJobListItem,
  type StaffOrder,
} from '@forgea/types';
import { ChangeOrderStatusDto, RecordPaymentDto } from '@forgea/validation';
import { data, Link, useFetcher } from 'react-router';
import { Money } from '~/components/money';
import { Button, buttonClass } from '~/components/ui/button';
import { DesignLines } from '~/features/text-studio/design-lines';
import { TextAreaField } from '~/components/ui/field';
import { useCan } from '~/features/admin/access';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { WhatsAppLink } from '~/features/contact/whatsapp-link';
import { StatusBar } from '~/features/admin/views';
import { relatedOf } from '~/features/admin/related.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';
import { InvoicesPanel } from './invoices-panel';
import { ProductionPanel } from './production-panel';

export async function loader({ params, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const [r, related, jobs] = await Promise.all([
    api.get<StaffOrder>(`/orders/${encodeURIComponent(params.id)}`),
    relatedOf(api, 'order', params.id),
    // Only for staff who run production (others get a 403 and no panel).
    api.get<Page<PrintJobListItem>>(
      `/print-jobs?limit=100&orderId=${encodeURIComponent(params.id)}`,
    ),
  ]);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { order: r.data, related, jobs: jobs.ok ? jobs.data.items : null };
}

/** status (the next step) | deposit-invoice | final-invoice | post-invoice | payment */
export async function action({ request, params, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const intent = form.get('intent');
  const orderPath = `/accounting/orders/${encodeURIComponent(params.id)}`;
  if (intent === 'post-invoice') {
    const invoiceId = text(form, 'invoiceId') ?? '';
    if (!/^[0-9a-f-]{36}$/.test(invoiceId))
      return data<SaveResult>({ error: 'Choose an invoice' }, { status: 400 });
    const r = await api.post(
      `/accounting/invoices/${encodeURIComponent(invoiceId)}/post`,
    );
    return r.ok
      ? data<SaveResult>({ ok: true })
      : data<SaveResult>({ error: r.message }, { status: r.status });
  }
  if (intent === 'deposit-invoice' || intent === 'final-invoice') {
    const date = text(form, 'invoiceDate');
    const dueDate = text(form, 'dueDate');
    const r = await api.post(`${orderPath}/${intent}`, {
      draft: form.get('as') === 'draft',
      ...(date ? { date } : {}),
      ...(dueDate ? { dueDate } : {}),
    });
    return r.ok
      ? data<SaveResult>({ ok: true })
      : data<SaveResult>({ error: r.message }, { status: r.status });
  }
  if (intent === 'credit-note') {
    const invoiceId = text(form, 'invoiceId') ?? '';
    if (!/^[0-9a-f-]{36}$/.test(invoiceId))
      return data<SaveResult>({ error: 'Choose an invoice' }, { status: 400 });
    const r = await api.post(
      `/accounting/invoices/${encodeURIComponent(invoiceId)}/credit-note`,
    );
    return r.ok
      ? data<SaveResult>({ ok: true })
      : data<SaveResult>({ error: r.message }, { status: r.status });
  }
  if (intent === 'payment') {
    return save(
      RecordPaymentDto,
      {
        invoiceId: text(form, 'invoiceId'),
        amount: text(form, 'amount'),
        method: text(form, 'method'),
        date: text(form, 'date'),
      },
      (dto) => api.post('/accounting/payments', dto),
    );
  }
  return save(
    ChangeOrderStatusDto,
    {
      status: text(form, 'status'),
      note: text(form, 'note'),
      expectedStatus: text(form, 'expectedStatus'),
    },
    (dto) =>
      context
        .get(apiContext)
        .patch(`/orders/${encodeURIComponent(params.id)}/status`, dto),
  );
}

/** The status bar's steps, in order (cancelled shows apart). */
const FLOW = [
  OrderStatus.PENDING,
  OrderStatus.AWAITING_DEPOSIT,
  OrderStatus.CONFIRMED,
  OrderStatus.IN_PRODUCTION,
  OrderStatus.READY,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERED,
];

/** What each step is called on its button. */
const ACTION_LABELS: Partial<Record<OrderStatus, string>> = {
  [OrderStatus.AWAITING_DEPOSIT]: 'Ask for the deposit',
  [OrderStatus.CONFIRMED]: 'Confirm the order',
  [OrderStatus.IN_PRODUCTION]: 'Start production',
  [OrderStatus.READY]: 'Mark as ready',
  [OrderStatus.OUT_FOR_DELIVERY]: 'Send out for delivery',
  [OrderStatus.DELIVERED]: 'Mark as delivered',
  [OrderStatus.CANCELLED]: 'Cancel the order',
};

export default function OrderPage({ loaderData }: Route.ComponentProps) {
  const { order: o } = loaderData;
  const fetcher = useFetcher<SaveResult>();
  const can = useCan();
  const waitingForDeposit = o.status === OrderStatus.AWAITING_DEPOSIT;

  return (
    <>
      <AdminHeader
        trail={[{ label: 'Orders', to: '/admin/orders' }]}
        related={loaderData.related}
        title={o.orderNumber}
        intro={`${ORDER_STATUS_LABELS[o.status].title} · placed ${new Date(o.createdAt).toLocaleString('en-GB')}`}
        action={
          <Link
            to="/admin/orders"
            className="text-sm underline underline-offset-4"
          >
            All orders
          </Link>
        }
      />
      <StatusBar
        steps={FLOW.filter(
          (s) =>
            (s !== OrderStatus.AWAITING_DEPOSIT ||
              Number(o.depositRequired) > 0 ||
              o.status === s) &&
            (s !== OrderStatus.OUT_FOR_DELIVERY || o.delivery),
        ).map((s) => ({ key: s, label: ORDER_STATUS_LABELS[s].title }))}
        current={o.status}
        aside={
          o.status === OrderStatus.CANCELLED
            ? ORDER_STATUS_LABELS.CANCELLED.title
            : undefined
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid content-start gap-6">
          <Panel title="Items">
            <ul className="grid gap-3">
              {o.items.map((i, n) => (
                <li key={n} className="flex justify-between gap-4">
                  <span>
                    <span className="font-semibold">
                      {i.quantity} ×{' '}
                      {i.productSlug ? (
                        <Link
                          to={`/products/${i.productSlug}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {i.name}
                        </Link>
                      ) : (
                        i.name
                      )}
                    </span>
                    {i.isCustom && (
                      <span className="ml-2 text-xs text-warning">
                        Made to order
                      </span>
                    )}
                    {i.design && (
                      <span className="mt-1 grid gap-2">
                        <DesignLines design={i.design} />
                        <span className="flex flex-wrap gap-2">
                          {i.design.files.length > 1 && (
                            <a
                              href={`/admin/orders/${o.id}/project/${i.design.itemId}`}
                              download
                              title="One object with a part per colour, placed as designed: turn it as a whole in the slicer and give each part its filament"
                              className={buttonClass(
                                'primary',
                                'px-3 py-1 text-sm',
                              )}
                            >
                              Download all (3MF)
                            </a>
                          )}
                          {i.design.files.map((f) => (
                            <a
                              key={f.colour}
                              href={`/admin/orders/${o.id}/print/${i.design!.itemId}/${encodeURIComponent(f.colour)}`}
                              download
                              className={buttonClass(
                                'secondary',
                                'px-3 py-1 text-sm',
                              )}
                            >
                              Print file: {f.colour}
                            </a>
                          ))}
                        </span>
                      </span>
                    )}
                    {i.options.length > 0 && (
                      <span className="block text-sm text-text-muted">
                        {i.options
                          .map((c) => `${c.group}: ${c.value}`)
                          .join(', ')}
                      </span>
                    )}
                  </span>
                  <Money amount={i.lineTotal} />
                </li>
              ))}
            </ul>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-1 border-t border-border pt-3 text-sm">
              {o.priceBreakdown.map((l) => (
                <div key={l.label} className="contents">
                  <dt className="text-text-muted">{l.label}</dt>
                  <dd className="text-right">
                    <Money amount={l.amount} />
                  </dd>
                </div>
              ))}
              <dt className="font-semibold">Total</dt>
              <dd className="text-right font-semibold">
                <Money amount={o.total} />
              </dd>
              {o.currencyCode !== 'USD' && (
                <>
                  <dt className="text-text-muted">
                    Paid in {o.currencyCode} (rate {o.exchangeRate})
                  </dt>
                  <dd className="text-right">
                    {o.totalInCurrency} {o.currencyCode}
                  </dd>
                </>
              )}
            </dl>
          </Panel>

          <Panel title="Customer and delivery">
            <p>
              {o.customer.name} · {o.customer.email} ·{' '}
              <a href={`tel:${o.customer.phone}`} className="underline">
                {o.customer.phone}
              </a>
            </p>
            <WhatsAppLink
              phone={o.customer.phone}
              message={`Hello ${o.customer.name}, this is Forgea about your order ${o.orderNumber}.`}
              className="text-sm underline underline-offset-4"
            >
              Message the customer on WhatsApp
            </WhatsAppLink>
            <p>
              {o.delivery
                ? `Deliver to ${o.addressLine ?? ''}, ${o.city ?? ''}`
                : 'Pickup from the studio'}
              {o.rush && <strong className="ml-2 text-warning">Rush</strong>}
            </p>
            {o.deliveryNotes && (
              <p className="text-sm text-text-muted">{o.deliveryNotes}</p>
            )}
            <p className="text-sm">
              {PAYMENT_METHOD_LABELS[o.paymentMethod]}
              {Number(o.depositRequired) > 0 && (
                <>
                  {' · deposit '}
                  <Money amount={o.depositRequired} />{' '}
                  {o.depositPaid ? (
                    <span className="text-success">received</span>
                  ) : (
                    <span className="text-warning">not yet received</span>
                  )}
                </>
              )}
            </p>
            {o.customRequestNumber && (
              <p className="text-sm">
                From custom request {o.customRequestNumber}
              </p>
            )}
          </Panel>
          {loaderData.jobs && (
            <ProductionPanel
              jobs={loaderData.jobs}
              orderId={o.id}
              total={o.total}
            />
          )}
        </div>

        <div className="grid content-start gap-6">
          <Panel title="Next step">
            {o.nextStatuses.length === 0 ? (
              <p className="text-text-muted">This order is closed.</p>
            ) : !can('orders.manage') ? (
              <p className="text-text-muted">
                Waiting for: {ORDER_STATUS_LABELS[o.nextStatuses[0]!].title}
              </p>
            ) : (
              // Keyed by status: once a step is saved its note is cleared, never sent with the next.
              <fetcher.Form key={o.status} method="post" className="grid gap-3">
                <input type="hidden" name="expectedStatus" value={o.status} />
                <TextAreaField
                  label="Note for the customer (optional)"
                  name="note"
                  rows={2}
                  hint="e.g. the courier's tracking number, or how the deposit was paid"
                  error={fetcher.data?.errors?.['note']}
                />
                {o.nextStatuses.map((s) => (
                  <Button
                    key={s}
                    type="submit"
                    name="status"
                    value={s}
                    variant={
                      s === OrderStatus.CANCELLED ? 'secondary' : 'primary'
                    }
                    disabled={fetcher.state !== 'idle'}
                  >
                    {waitingForDeposit && s === OrderStatus.CONFIRMED
                      ? 'Deposit received, confirm'
                      : ACTION_LABELS[s]}
                  </Button>
                ))}
                <SaveStatus state={fetcher.state} result={fetcher.data} />
              </fetcher.Form>
            )}
          </Panel>
          {o.invoices && <InvoicesPanel order={o} invoices={o.invoices} />}
          <Panel title="History">
            <ol className="grid gap-3 border-l border-border pl-4 text-sm">
              {o.history.map((h) => (
                <li key={h.changedAt + h.status}>
                  <p className="font-semibold">
                    {ORDER_STATUS_LABELS[h.status].title}
                  </p>
                  <p className="text-text-muted">
                    {new Date(h.changedAt).toLocaleString('en-GB')}
                    {h.changedBy ? ` · ${h.changedBy}` : ''}
                  </p>
                  {h.note && <p>{h.note}</p>}
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}
