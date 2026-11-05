import {
  type ProductListItem,
  type CheckoutResult,
  type Page,
  PAYMENT_METHOD_LABELS,
  PaymentMethod,
  type QuotationDetail,
  QuotationStatus,
} from '@forgea/types';
import { SaveQuotationDto } from '@forgea/validation';
import { useState } from 'react';
import { data, Link, redirect, useFetcher } from 'react-router';
import { Money } from '~/components/money';
import { Button } from '~/components/ui/button';
import {
  CheckboxField,
  Field,
  SelectField,
  TextAreaField,
} from '~/components/ui/field';
import { useCan } from '~/features/admin/access';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import {
  checked,
  type SaveResult,
  save,
  text,
} from '~/features/admin/staff.server';
import { jsonField } from '~/lib/forms.server';
import { StatusBar } from '~/features/admin/views';
import { relatedOf } from '~/features/admin/related.server';
import { DeliveryAreaField } from '~/features/orders/delivery-area-field';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ params, url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  // The shop's own list (what is for sale, at today's prices): quoting needs no catalog access.
  const isNew = params.id === 'new';
  const [products, quotation] = await Promise.all([
    api.get<Page<ProductListItem>>('/products?limit=100&sort=name&order=asc'),
    isNew
      ? null
      : api.get<QuotationDetail>(
          `/quotations/${encodeURIComponent(params.id)}`,
        ),
  ]);
  if (quotation && !quotation.ok)
    throw new Response(quotation.message, { status: quotation.status });
  const in30 = new Date(Date.now() + 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return {
    quotation: quotation?.ok ? quotation.data : null,
    related: isNew ? [] : await relatedOf(api, 'quotation', params.id),
    products: products.ok ? products.data.items : [],
    // Coming from a lead: who it's for.
    prefill: {
      leadId: url.searchParams.get('lead'),
      email: url.searchParams.get('email') ?? '',
      name: url.searchParams.get('name') ?? '',
      validUntil: in30,
    },
  };
}

type ActionResult = SaveResult & { order?: CheckoutResult };

/** save | send | confirm | cancel */
export async function action({ request, params, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const intent = form.get('intent');
  const base = `/quotations/${encodeURIComponent(params.id)}`;
  if (intent === 'send' || intent === 'confirm' || intent === 'cancel') {
    const r =
      intent === 'cancel'
        ? await api.post(`${base}/cancel`, {
            body: text(form, 'note') ?? 'Cancelled',
          })
        : await api.post<CheckoutResult>(`${base}/${intent}`);
    if (!r.ok)
      return data<ActionResult>({ error: r.message }, { status: r.status });
    return data<ActionResult>({
      ok: true,
      ...(intent === 'confirm' ? { order: r.data as CheckoutResult } : {}),
    });
  }
  let createdId: string | undefined;
  const result = await save(
    SaveQuotationDto,
    {
      customerEmail: text(form, 'customerEmail'),
      leadId: text(form, 'leadId'),
      validUntil: text(form, 'validUntil'),
      note: text(form, 'note'),
      customerName: text(form, 'customerName'),
      phone: text(form, 'phone'),
      paymentMethod: text(form, 'paymentMethod'),
      delivery: checked(form, 'delivery'),
      city: text(form, 'city'),
      addressLine: text(form, 'addressLine'),
      lines: jsonField(form, 'lines') ?? [],
    },
    async (dto) => {
      const r =
        params.id === 'new'
          ? await api.post<{ id: string }>('/quotations', dto)
          : await api.put<{ id: string }>(base, dto);
      if (r.ok && params.id === 'new') createdId = r.data.id;
      return r;
    },
  );
  if (createdId) throw redirect(`/admin/quotations/${createdId}`);
  return result;
}

interface Line {
  productId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  isCustom: boolean;
  /** Printed size in cm: width, depth, height (all three or none). */
  sizeX: string;
  sizeY: string;
  sizeZ: string;
}

const lineTotal = (l: Line) =>
  ((Number(l.quantity) || 0) *
    (Number(l.unitPrice) || 0) *
    (100 - (Number(l.discountPercent) || 0))) /
  100;

export default function QuotationPage({ loaderData }: Route.ComponentProps) {
  const { quotation: q, products, prefill } = loaderData;
  const fetcher = useFetcher<ActionResult>();
  const errors = fetcher.data?.errors ?? {};
  const mayManage = useCan()('quotations.manage');
  const editable =
    mayManage &&
    (!q ||
      q.status === QuotationStatus.DRAFT ||
      q.status === QuotationStatus.SENT ||
      // Declined: change it, then send it again.
      q.status === QuotationStatus.DECLINED);
  const [delivery, setDelivery] = useState(q?.delivery ?? false);
  const [lines, setLines] = useState<Line[]>(
    q?.lines.map((l) => ({
      productId: l.productId ?? '',
      description: l.description,
      quantity: String(l.quantity),
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      isCustom: l.isCustom,
      sizeX: l.size?.x ?? '',
      sizeY: l.size?.y ?? '',
      sizeZ: l.size?.z ?? '',
    })) ?? [
      {
        productId: '',
        description: '',
        quantity: '1',
        unitPrice: '',
        discountPercent: '0',
        isCustom: false,
        sizeX: '',
        sizeY: '',
        sizeZ: '',
      },
    ],
  );
  const set = (i: number, change: Partial<Line>) =>
    setLines((all) => all.map((l, j) => (j === i ? { ...l, ...change } : l)));
  const total = lines.reduce((s, l) => s + lineTotal(l), 0);

  return (
    <>
      <AdminHeader
        trail={[{ label: 'Quotations', to: '/admin/quotations' }]}
        related={loaderData.related}
        title={q ? q.number : 'New quotation'}
        intro={
          q
            ? `${q.expired ? 'Expired' : q.status.toLowerCase()} · for ${q.customer.email}${q.orderNumber ? ` · order ${q.orderNumber}` : ''}`
            : 'For anyone with an email address: sending it emails the full quotation with a link to accept it online. Prices in USD, taxes included, like the shop.'
        }
        action={
          <Link
            to="/admin/quotations"
            className="text-sm underline underline-offset-4"
          >
            All quotations
          </Link>
        }
      />
      {q && (
        <StatusBar
          steps={[
            { key: 'DRAFT', label: 'Draft' },
            { key: 'SENT', label: 'Sent' },
            { key: 'CONFIRMED', label: 'Confirmed' },
          ]}
          current={q.status}
          aside={
            q.status === 'CANCELLED'
              ? 'Cancelled'
              : q.status === 'DECLINED'
                ? 'Declined by the customer'
                : q.expired && q.status !== 'CONFIRMED'
                  ? 'Expired'
                  : undefined
          }
        />
      )}
      <fetcher.Form method="post" className="grid gap-6">
        <input type="hidden" name="intent" value="save" />
        {prefill.leadId && (
          <input
            type="hidden"
            name="leadId"
            value={q?.leadId ?? prefill.leadId}
          />
        )}
        {q?.leadId && !prefill.leadId && (
          <input type="hidden" name="leadId" value={q.leadId} />
        )}
        <input
          type="hidden"
          name="lines"
          value={JSON.stringify(
            lines.map((l) => ({
              ...(l.productId ? { productId: l.productId } : {}),
              description: l.description,
              quantity: Number(l.quantity),
              unitPrice: l.unitPrice,
              discountPercent: l.discountPercent || '0',
              isCustom: l.isCustom,
              ...(l.sizeX || l.sizeY || l.sizeZ
                ? { sizeXcm: l.sizeX, sizeYcm: l.sizeY, sizeZcm: l.sizeZ }
                : {}),
            })),
          )}
        />
        <fieldset disabled={!editable} className="grid gap-6">
          <Panel title="Customer">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field
                label="Customer email"
                hint="No account needed: they get it by email"
                autoComplete="off"
                name="customerEmail"
                type="email"
                required
                defaultValue={q?.customer.email ?? prefill.email}
                error={errors['customerEmail']}
              />
              <Field
                label="Name for the order"
                name="customerName"
                required
                defaultValue={q?.customerName ?? prefill.name}
                error={errors['customerName']}
              />
              <Field
                label="Phone"
                name="phone"
                type="tel"
                required
                defaultValue={q?.phone}
                error={errors['phone']}
              />
              <Field
                label="Valid until"
                name="validUntil"
                type="date"
                required
                defaultValue={q?.validUntil ?? prefill.validUntil}
                error={errors['validUntil']}
              />
              <SelectField
                label="Payment"
                name="paymentMethod"
                defaultValue={q?.paymentMethod ?? PaymentMethod.TRANSFER}
              >
                {Object.values(PaymentMethod).map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </SelectField>
              <CheckboxField
                label="Deliver it"
                name="delivery"
                checked={delivery}
                onChange={(e) => setDelivery(e.currentTarget.checked)}
              />
              {delivery && (
                <>
                  <DeliveryAreaField value={q?.city} error={errors['city']} />
                  <Field
                    label="Street, building, floor"
                    name="addressLine"
                    defaultValue={q?.addressLine ?? undefined}
                    error={errors['addressLine']}
                  />
                </>
              )}
            </div>
          </Panel>

          <Panel title="Lines">
            {lines.map((l, i) => (
              <div
                key={i}
                className="grid gap-2 border-b border-border pb-3 sm:grid-cols-[12rem_minmax(0,1fr)_5rem_7rem_6rem_auto] sm:items-end"
              >
                <SelectField
                  label="Product"
                  name={`line-${i}-product`}
                  value={l.productId}
                  onChange={(e) => {
                    const p = products.find(
                      (x) => x.id === e.currentTarget.value,
                    );
                    set(
                      i,
                      p
                        ? {
                            productId: p.id,
                            description: p.name,
                            unitPrice: p.price,
                          }
                        : { productId: '' },
                    );
                  }}
                >
                  <option value="">Free text</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </SelectField>
                <Field
                  label="Description"
                  name={`line-${i}-description`}
                  value={l.description}
                  onChange={(e) =>
                    set(i, { description: e.currentTarget.value })
                  }
                />
                <Field
                  label="Qty"
                  name={`line-${i}-quantity`}
                  type="number"
                  min={1}
                  value={l.quantity}
                  onChange={(e) => set(i, { quantity: e.currentTarget.value })}
                />
                <Field
                  label="Unit price"
                  name={`line-${i}-price`}
                  inputMode="decimal"
                  value={l.unitPrice}
                  onChange={(e) => set(i, { unitPrice: e.currentTarget.value })}
                />
                <Field
                  label="Discount %"
                  name={`line-${i}-discount`}
                  inputMode="decimal"
                  value={l.discountPercent}
                  onChange={(e) =>
                    set(i, { discountPercent: e.currentTarget.value })
                  }
                />
                <div className="flex items-center gap-3 pb-2 text-sm">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      name={`line-${i}-custom`}
                      checked={l.isCustom}
                      onChange={(e) =>
                        set(i, { isCustom: e.currentTarget.checked })
                      }
                    />{' '}
                    Made to order
                  </label>
                  <span className="tabular-nums">
                    ${lineTotal(l).toFixed(2)}
                  </span>
                  {lines.length > 1 && (
                    <Button
                      variant="quiet"
                      onClick={() =>
                        setLines((all) => all.filter((_, j) => j !== i))
                      }
                    >
                      Remove
                    </Button>
                  )}
                </div>
                <fieldset className="grid grid-cols-3 gap-2 sm:col-span-full sm:max-w-md">
                  <legend className="mb-1 text-sm font-medium">
                    Printed size, cm (optional: all three)
                  </legend>
                  {(
                    [
                      ['sizeX', 'Width'],
                      ['sizeY', 'Depth'],
                      ['sizeZ', 'Height'],
                    ] as const
                  ).map(([key, label]) => (
                    <Field
                      key={key}
                      label={label}
                      name={`line-${i}-${key}`}
                      inputMode="decimal"
                      placeholder="cm"
                      autoComplete="off"
                      value={l[key]}
                      onChange={(e) => set(i, { [key]: e.currentTarget.value })}
                    />
                  ))}
                </fieldset>
              </div>
            ))}
            {Object.entries(errors)
              .filter(([k]) => k.startsWith('lines'))
              .slice(0, 1)
              .map(([k, m]) => (
                <p key={k} className="text-sm text-danger">
                  {m}
                </p>
              ))}
            <div className="flex items-center justify-between">
              <Button
                variant="secondary"
                onClick={() =>
                  setLines((all) => [
                    ...all,
                    {
                      productId: '',
                      description: '',
                      quantity: '1',
                      unitPrice: '',
                      discountPercent: '0',
                      isCustom: false,
                      sizeX: '',
                      sizeY: '',
                      sizeZ: '',
                    },
                  ])
                }
              >
                Add a line
              </Button>
              <p className="text-lg font-semibold">
                Total <Money amount={total.toFixed(2)} />
              </p>
            </div>
            <TextAreaField
              label="Note for the customer (optional)"
              name="note"
              defaultValue={q?.note ?? undefined}
              rows={2}
            />
          </Panel>
        </fieldset>
        {editable && (
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={fetcher.state !== 'idle'}>
              {q ? 'Save changes' : 'Create the quotation'}
            </Button>
            <SaveStatus state={fetcher.state} result={fetcher.data} />
          </div>
        )}
      </fetcher.Form>
      {q && <QuotationActions quotation={q} mayManage={mayManage} />}
    </>
  );
}

function QuotationActions({
  quotation: q,
  mayManage,
}: {
  quotation: QuotationDetail;
  mayManage: boolean;
}) {
  const fetcher = useFetcher<ActionResult>();
  const open =
    q.status === QuotationStatus.DRAFT ||
    q.status === QuotationStatus.SENT ||
    q.status === QuotationStatus.DECLINED;
  const declinedWhy =
    q.status === QuotationStatus.DECLINED
      ? q.history.findLast((h) => h.status === QuotationStatus.DECLINED)?.note
      : undefined;
  return (
    <Panel title="Next" className="mt-6">
      {fetcher.data?.order && (
        <p className="font-semibold text-success">
          Order {fetcher.data.order.orderNumber} created; it is in Orders.
        </p>
      )}
      {q.status === QuotationStatus.DECLINED && (
        <p role="status" className="rounded-md bg-surface p-3 text-sm">
          <strong>The customer declined it.</strong>{' '}
          {declinedWhy ? `Their reason: "${declinedWhy}". ` : ''}
          Change it and send it again, confirm it if they said yes another way,
          or cancel it.
        </p>
      )}
      {open && !mayManage ? (
        <p className="text-sm text-text-muted">
          {q.status === QuotationStatus.SENT
            ? 'Sent to the customer.'
            : q.status === QuotationStatus.DECLINED
              ? 'Declined by the customer.'
              : 'Draft.'}
        </p>
      ) : open ? (
        <fetcher.Form method="post" className="flex flex-wrap gap-3">
          <Button
            type="submit"
            name="intent"
            value="send"
            variant="secondary"
            disabled={fetcher.state !== 'idle'}
          >
            {q.status === QuotationStatus.SENT
              ? 'Send it again'
              : q.status === QuotationStatus.DECLINED
                ? 'Send the new version'
                : 'Send to the customer'}
          </Button>
          <Button
            type="submit"
            name="intent"
            value="confirm"
            disabled={fetcher.state !== 'idle' || q.expired}
          >
            Confirm: create the order
          </Button>
          <Button
            type="submit"
            name="intent"
            value="cancel"
            variant="quiet"
            disabled={fetcher.state !== 'idle'}
            onClick={(e) => {
              // Cancelled is final (the customer's link stops working): ask first.
              if (!window.confirm(`Cancel quotation ${q.number}?`))
                e.preventDefault();
            }}
          >
            Cancel the quotation
          </Button>
        </fetcher.Form>
      ) : (
        <p className="text-sm text-text-muted">
          {q.status === QuotationStatus.CONFIRMED
            ? `Confirmed as order ${q.orderNumber}.`
            : 'Cancelled.'}
        </p>
      )}
      <SaveStatus state={fetcher.state} result={fetcher.data} />
      <ol className="grid gap-1 border-l border-border pl-4 text-sm">
        {q.history.map((h) => (
          <li key={h.changedAt + h.status}>
            {h.status.toLowerCase()} ·{' '}
            {new Date(h.changedAt).toLocaleString('en-GB')}
            {h.note ? ` · ${h.note}` : ''}
          </li>
        ))}
      </ol>
    </Panel>
  );
}
