import { randomUUID } from 'node:crypto';
import {
  ORDER_STATUS_LABELS,
  type OrderProduction,
  type OrderRemovalPreview,
  OrderStatus,
  type Page,
  PAYMENT_METHOD_LABELS,
  PIECE_STAGE_LABELS,
  type PieceView,
  type PrintJobListItem,
  type StaffOrder,
} from '@forgea/types';
import {
  ChangeOrderStatusDto,
  RecordPaymentDto,
  RemoveTestOrderDto,
} from '@forgea/validation';
import { data, Link, redirect, useFetcher } from 'react-router';
import { Money } from '~/components/money';
import { Button, buttonClass } from '~/components/ui/button';
import { DesignLines } from '~/features/text-studio/design-lines';
import { Field, TextAreaField } from '~/components/ui/field';
import { useCan } from '~/features/admin/access';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { WhatsAppLink } from '~/features/contact/whatsapp-link';
import { StatusBar } from '~/features/admin/views';
import { relatedOf } from '~/features/admin/related.server';
import { apiContext } from '~/lib/request.server';
import { studioDateTime } from '~/lib/studio-time';
import type { Route } from './+types/route';
import { InvoicesPanel } from './invoices-panel';
import { OrderFigures } from './order-figures';
import { ProductionPanel } from './production-panel';

export async function loader({ params, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const [r, related, jobs, production, removal, pieces] = await Promise.all([
    api.get<StaffOrder>(`/orders/${encodeURIComponent(params.id)}`),
    relatedOf(api, 'order', params.id),
    // Only for staff who run production (others get a 403 and no panel).
    api.get<Page<PrintJobListItem>>(
      `/print-jobs?limit=100&orderId=${encodeURIComponent(params.id)}`,
    ),
    api.get<OrderProduction>(
      `/orders/${encodeURIComponent(params.id)}/production`,
    ),
    // Admins only (others get 403): what removing it as a test order would take away.
    api.get<OrderRemovalPreview>(
      `/orders/${encodeURIComponent(params.id)}/removal`,
    ),
    // Where its pieces are now (the "Where it is" board), for whoever sees the stock.
    api.get<Page<PieceView>>(
      `/pieces?limit=50&orderId=${encodeURIComponent(params.id)}`,
    ),
  ]);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return {
    order: r.data,
    related,
    jobs: jobs.ok ? jobs.data.items : null,
    production: production.ok ? production.data : null,
    removal: removal.ok ? removal.data : null,
    pieces: pieces.ok ? pieces.data.items : null,
    // A fresh one-time key per load (after a save too): a payment sent twice counts once.
    requestKey: randomUUID(),
  };
}

/** status (the next step) | deposit-invoice | final-invoice | post-invoice | payment */
export async function action({ request, params, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const intent = form.get('intent');
  const orderPath = `/accounting/orders/${encodeURIComponent(params.id)}`;
  // A test order removed entirely (admins only): back to the orders.
  if (intent === 'remove-test') {
    const result = await save(
      RemoveTestOrderDto,
      { confirm: text(form, 'confirm') },
      (dto) => api.post(`/orders/${encodeURIComponent(params.id)}/remove`, dto),
    );
    if (result.data && 'ok' in result.data && result.data.ok)
      throw redirect('/admin/orders?filter=');
    return result;
  }
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
        requestKey: text(form, 'requestKey'),
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

/**
 * Admins only: an order that never happened (a test) removed entirely, with its invoices,
 * credit notes, the payments matched to them, its print runs and the filament they took. Says
 * first what goes, and asks for the order number to be typed again.
 */
function RemoveTestOrder({ preview: r }: { preview: OrderRemovalPreview }) {
  const fetcher = useFetcher<SaveResult>();
  return (
    <Panel
      title="Remove this test order"
      fold={{ open: false, holds: 'admins only' }}
    >
      <p className="text-sm text-text-muted">
        Only for an order that never really happened. Real orders are cancelled,
        never removed. This removes the order and everything it made:
      </p>
      <ul className="list-disc pl-5 text-sm">
        <li>
          {r.lines} line{r.lines === 1 ? '' : 's'}, {r.printRuns} print run
          {r.printRuns === 1 ? '' : 's'}, {r.pieces} piece
          {r.pieces === 1 ? '' : 's'} on the board
        </li>
        <li>
          {r.stockMovements} filament record
          {r.stockMovements === 1 ? '' : 's'} (the shelf gets its grams back)
        </li>
        <li>
          {r.documents.length > 0
            ? `Its documents: ${r.documents.join(', ')}`
            : 'No invoices or payments'}
        </li>
      </ul>
      {r.blockedBy.length > 0 ? (
        <p className="text-sm text-danger">
          It can&apos;t be removed: {r.blockedBy.join('; ')}.
        </p>
      ) : (
        <fetcher.Form method="post" className="grid gap-3">
          <input type="hidden" name="intent" value="remove-test" />
          <Field
            label={`Type ${r.orderNumber} to remove it`}
            name="confirm"
            autoComplete="off"
            required
            error={fetcher.data?.errors?.['confirm']}
          />
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              variant="secondary"
              disabled={fetcher.state !== 'idle'}
            >
              Remove the test order
            </Button>
            <SaveStatus state={fetcher.state} result={fetcher.data} />
          </div>
        </fetcher.Form>
      )}
    </Panel>
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
        intro={`${ORDER_STATUS_LABELS[o.status].title} · placed ${studioDateTime(o.createdAt)}`}
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
      {loaderData.production && (
        <OrderFigures
          order={o}
          production={loaderData.production}
          jobs={loaderData.jobs}
        />
      )}
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
                    {i.printProject && (
                      <span className="mt-1 flex flex-wrap gap-2">
                        <a
                          href={`/admin/orders/${o.id}/project/${i.id}`}
                          download
                          title="The product's own Bambu Studio project: its colours, plates and settings"
                          className={buttonClass(
                            'primary',
                            'px-3 py-1 text-sm',
                          )}
                        >
                          Download print project (3MF)
                        </a>
                      </span>
                    )}
                    {i.printFiles.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-2">
                        {i.printFiles.map((f) => (
                          <a
                            key={f.id}
                            href={`/admin/orders/${o.id}/print-file/${i.id}/${f.id}`}
                            download
                            title="A sliced print file of this product, ready for the printer"
                            className={buttonClass(
                              'secondary',
                              'px-3 py-1 text-sm',
                            )}
                          >
                            Sliced file: {f.name}
                          </a>
                        ))}
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
          {loaderData.pieces && loaderData.pieces.length > 0 && (
            <Panel title="Where its pieces are">
              <ul className="grid gap-2 text-sm">
                {loaderData.pieces.map((p) => (
                  <li key={p.id}>
                    <Link
                      to={`/admin/pieces/${p.id}`}
                      className="font-semibold underline-offset-4 hover:underline"
                    >
                      {p.quantity} × {p.name}
                    </Link>
                    {' · '}
                    {PIECE_STAGE_LABELS[p.stage]}
                    {(p.holder || p.holderAccount) &&
                      ` · ${p.holder ?? p.holderAccount?.name ?? p.holderAccount?.email}`}
                    {p.note && (
                      <span className="block text-text-muted">
                        As printed: {p.note}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {loaderData.removal && (
            <RemoveTestOrder preview={loaderData.removal} />
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
          {o.invoices && (
            <div id="order-invoices">
              <InvoicesPanel
                order={o}
                invoices={o.invoices}
                requestKey={loaderData.requestKey}
              />
            </div>
          )}
          <Panel title="History">
            <ol className="grid gap-3 border-l border-border pl-4 text-sm">
              {o.history.map((h) => (
                <li key={h.changedAt + h.status}>
                  <p className="font-semibold">
                    {ORDER_STATUS_LABELS[h.status].title}
                  </p>
                  <p className="text-text-muted">
                    {studioDateTime(h.changedAt)}
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
