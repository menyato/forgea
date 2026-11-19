export { unlessAsking as shouldRevalidate } from '~/lib/revalidate';
import {
  type QuotableProduct,
  type CheckoutResult,
  type Page,
  PAYMENT_METHOD_LABELS,
  type PrintFile,
  type QuotationPrintFileView,
  type UploadedFile,
  PaymentMethod,
  type QuotationDetail,
  QuotationStatus,
} from '@forgea/types';
import { SaveQuotationDto } from '@forgea/validation';
import { useEffect, useRef, useState } from 'react';
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
  saveNew,
  text,
} from '~/features/admin/staff.server';
import { jsonField } from '~/lib/forms.server';
import { StatusBar } from '~/features/admin/views';
import { relatedOf } from '~/features/admin/related.server';
import { DeliveryAreaField } from '~/features/orders/delivery-area-field';
import type { ApiClient } from '~/lib/api-client.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';
import type { QuotationLookup } from '../admin.quotations.lookup/route';
import { LinePrintFile, type PrintFileResult } from './line-print-file';

export async function loader({ params, url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const isNew = params.id === 'new';
  const [products, quotation, related] = await Promise.all([
    // Every product, launched in the shop or not: a piece made for one client is quoted
    // like any other.
    api.get<QuotableProduct[]>('/products/quotable'),
    isNew
      ? null
      : api.get<QuotationDetail>(
          `/quotations/${encodeURIComponent(params.id)}`,
        ),
    isNew ? [] : relatedOf(api, 'quotation', params.id),
  ]);
  if (quotation && !quotation.ok)
    throw new Response(quotation.message, { status: quotation.status });
  const in30 = new Date(Date.now() + 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return {
    quotation: quotation?.ok ? quotation.data : null,
    related,
    products: products.ok ? products.data : [],
    // Coming from a lead: who it's for.
    prefill: {
      // From Orders → New order: the same form, made into the order at once.
      asOrder: url.searchParams.get('order') === '1',
      // It was saved, but could not become an order yet (the API's reason).
      notOrdered: url.searchParams.get('not-ordered'),
      leadId: url.searchParams.get('lead'),
      email: url.searchParams.get('email') ?? '',
      name: url.searchParams.get('name') ?? '',
      validUntil: in30,
    },
  };
}

type ActionResult = SaveResult & { order?: CheckoutResult };

/** save | send | confirm | cancel | print-file */
export async function action({ request, params, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const intent = form.get('intent');
  const base = `/quotations/${encodeURIComponent(params.id)}`;
  // A line's 3D file: uploaded (or read again in another material) and read by the API.
  if (intent === 'print-file') return printFile(api, form);
  if (intent === 'order') return newOrder(api, form);
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
  return saveNew(
    SaveQuotationDto,
    quotationValues(form),
    (dto) =>
      params.id === 'new'
        ? api.post<{ id: string }>('/quotations', dto)
        : api.put<{ id: string }>(base, dto),
    (saved) => (params.id === 'new' ? `/admin/quotations/${saved.id}` : null),
  );
}

/**
 * A sale the studio makes itself (a walk-in, a WhatsApp order): written as a quotation, as
 * every sale is, and confirmed in the same step, so it opens as the order. If it can't become
 * one yet, it stays as a quotation and its page says why.
 */
async function newOrder(api: ApiClient, form: FormData) {
  let quotationId: string | undefined;
  const result = await save(
    SaveQuotationDto,
    quotationValues(form),
    async (dto) => {
      const r = await api.post<{ id: string }>('/quotations', dto);
      if (r.ok) quotationId = r.data.id;
      return r;
    },
  );
  if (!quotationId) return result;
  const path = `/quotations/${quotationId}`;
  const page = `/admin${path}`;
  const confirmed = await api.post<CheckoutResult>(`${path}/confirm`);
  if (!confirmed.ok)
    throw redirect(
      `${page}?not-ordered=${encodeURIComponent(confirmed.message)}`,
    );
  const made = await api.get<QuotationDetail>(path);
  throw redirect(
    made.ok && made.data.orderId ? `/admin/orders/${made.data.orderId}` : page,
  );
}

/** The quotation form's fields, as the shared DTO reads them. */
const quotationValues = (form: FormData) => ({
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
});

async function printFile(api: ApiClient, form: FormData) {
  let key = text(form, 'key');
  const file = form.get('file');
  if (file instanceof File && file.size > 0) {
    const upload = new FormData();
    upload.set('file', file, file.name);
    const r = await api.postForm<UploadedFile>(
      '/uploads/quotation-file',
      upload,
    );
    if (!r.ok)
      return data<PrintFileResult>({ error: r.message }, { status: r.status });
    key = r.data.key;
  }
  if (!key)
    return data<PrintFileResult>({ error: 'Choose a file' }, { status: 400 });
  const materialId = text(form, 'materialId');
  const r = await api.post<QuotationPrintFileView>('/quotations/print-file', {
    key,
    ...(materialId ? { materialId } : {}),
  });
  return r.ok
    ? data<PrintFileResult>({ file: r.data })
    : data<PrintFileResult>({ error: r.message }, { status: r.status });
}

interface Line {
  productId: string;
  /** The product's own size chosen, when it has sizes. */
  sizeId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  isCustom: boolean;
  /** Printed size in cm: width, depth, height (all three or none). */
  sizeX: string;
  sizeY: string;
  sizeZ: string;
  /** Made from a 3D file the API read: what one piece takes. */
  printFile: PrintFile | null;
}

const lineTotal = (l: Line) =>
  ((Number(l.quantity) || 0) *
    (Number(l.unitPrice) || 0) *
    (100 - (Number(l.discountPercent) || 0))) /
  100;

export default function QuotationPage({ loaderData }: Route.ComponentProps) {
  const { quotation: q, products, prefill } = loaderData;
  const asOrder = !q && prefill.asOrder;
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
  // What the studio knows about this email fills the fields still empty.
  const formRef = useRef<HTMLFormElement>(null);
  const contact = useFetcher<QuotationLookup | null>();
  const [area, setArea] = useState<string | null>(q?.city ?? null);
  useEffect(() => {
    const found =
      contact.data && 'contact' in contact.data ? contact.data.contact : null;
    const form = formRef.current;
    if (!found || !form) return;
    const fill = (name: string, value: string | null) => {
      const input = form.elements.namedItem(name);
      if (value && input instanceof HTMLInputElement && !input.value.trim())
        input.value = value;
    };
    fill('customerName', found.name);
    fill('phone', found.phone);
    if (found.city && !area) {
      setDelivery(true);
      setArea(found.city);
      // The address field appears with the delivery box: filled once it is there.
      requestAnimationFrame(() => fill('addressLine', found.addressLine));
    }
  }, [contact.data]);
  const [lines, setLines] = useState<Line[]>(
    q?.lines.map((l) => ({
      productId: l.productId ?? '',
      sizeId: '',
      description: l.description,
      quantity: String(l.quantity),
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      isCustom: l.isCustom,
      sizeX: l.size?.x ?? '',
      sizeY: l.size?.y ?? '',
      sizeZ: l.size?.z ?? '',
      printFile: l.printFile,
    })) ?? [
      {
        productId: '',
        sizeId: '',
        description: '',
        quantity: '1',
        unitPrice: '',
        discountPercent: '0',
        isCustom: false,
        sizeX: '',
        sizeY: '',
        sizeZ: '',
        printFile: null,
      },
    ],
  );
  const set = (i: number, change: Partial<Line>) =>
    setLines((all) => all.map((l, j) => (j === i ? { ...l, ...change } : l)));
  const total = lines.reduce((s, l) => s + lineTotal(l), 0);

  return (
    <>
      <AdminHeader
        trail={[
          asOrder
            ? { label: 'Orders', to: '/admin/orders' }
            : { label: 'Quotations', to: '/admin/quotations' },
        ]}
        related={loaderData.related}
        title={q ? q.number : asOrder ? 'New order' : 'New quotation'}
        intro={
          q
            ? `${q.expired ? 'Expired' : q.status.toLowerCase()} · for ${q.customer.email}${q.orderNumber ? ` · order ${q.orderNumber}` : ''}`
            : asOrder
              ? 'A sale you make yourself: a walk-in, a WhatsApp or phone order, a piece for a client. Who it is for and what they take; it opens as the order, ready to confirm and print. Prices in USD, taxes included, like the shop.'
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
      {q && prefill.notOrdered && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-warning bg-surface p-3 text-sm"
        >
          Saved as this quotation, but it could not become an order yet:{' '}
          {prefill.notOrdered} Fix it below, then press{' '}
          <strong>Confirm: create the order</strong>.
        </p>
      )}
      {q && (
        <StatusBar
          steps={[
            { key: 'DRAFT', label: 'Draft' },
            { key: 'SENT', label: 'Sent' },
            { key: 'CONFIRMED', label: 'Sales order' },
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
      <fetcher.Form ref={formRef} method="post" className="grid gap-6">
        <input type="hidden" name="intent" value={asOrder ? 'order' : 'save'} />
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
              ...(l.printFile
                ? {
                    printFileKey: l.printFile.fileKey,
                    printMaterialId: l.printFile.materialId,
                  }
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
                onBlur={(e) => {
                  const email = e.currentTarget.value.trim();
                  if (editable && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
                    void contact.load(
                      `/admin/quotations/lookup?email=${encodeURIComponent(email)}`,
                    );
                }}
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
                  <DeliveryAreaField
                    key={area ?? 'none'}
                    value={area}
                    error={errors['city']}
                  />
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
                            sizeId: '',
                            description: p.name,
                            unitPrice: p.price,
                            sizeX: '',
                            sizeY: '',
                            sizeZ: '',
                            printFile: null,
                          }
                        : { productId: '', sizeId: '' },
                    );
                  }}
                >
                  <option value="">Free text</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.active ? '' : ' (not in the shop)'}
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
                <LineSize
                  index={i}
                  line={l}
                  slug={products.find((p) => p.id === l.productId)?.slug}
                  onChange={(change) => set(i, change)}
                />
                {!l.productId && (
                  <LinePrintFile
                    index={i}
                    printFile={l.printFile}
                    onRead={(f) =>
                      set(i, {
                        printFile: f.printFile,
                        unitPrice: f.unitPrice,
                        sizeX: f.size.x,
                        sizeY: f.size.y,
                        sizeZ: f.size.z,
                        isCustom: true,
                        ...(l.description
                          ? {}
                          : { description: 'Custom print' }),
                      })
                    }
                    onRemove={() => set(i, { printFile: null })}
                  />
                )}
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
                      sizeId: '',
                      description: '',
                      quantity: '1',
                      unitPrice: '',
                      discountPercent: '0',
                      isCustom: false,
                      sizeX: '',
                      sizeY: '',
                      sizeZ: '',
                      printFile: null,
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
              {q
                ? 'Save changes'
                : asOrder
                  ? 'Create the order'
                  : 'Create the quotation'}
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
          Sales order {fetcher.data.order.orderNumber} created; it is in Orders.
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
      ) : q.status === QuotationStatus.CONFIRMED && q.orderId ? (
        <div className="grid gap-3">
          <p>
            Confirmed: it is now sales order{' '}
            <Link
              to={`/admin/orders/${q.orderId}`}
              className="font-semibold underline underline-offset-4"
            >
              {q.orderNumber}
            </Link>
            .
          </p>
          {mayManage && (
            <fetcher.Form method="post">
              <Button
                type="submit"
                name="intent"
                value="cancel"
                variant="quiet"
                disabled={fetcher.state !== 'idle'}
                onClick={(e) => {
                  if (
                    !window.confirm(
                      `Cancel quotation ${q.number} and its order ${q.orderNumber}? The customer is told.`,
                    )
                  )
                    e.preventDefault();
                }}
              >
                Cancel the quotation and its order
              </Button>
            </fetcher.Form>
          )}
        </div>
      ) : (
        <p className="text-sm text-text-muted">
          Cancelled
          {q.orderId ? (
            <>
              {' '}
              with its order{' '}
              <Link
                to={`/admin/orders/${q.orderId}`}
                className="underline underline-offset-4"
              >
                {q.orderNumber}
              </Link>
            </>
          ) : null}
          .
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

/**
 * A line's printed size: a product's own sizes to choose from (each with its price), or, for a
 * free-text line or a product without sizes, the measurements typed in.
 */
function LineSize({
  index: i,
  line: l,
  slug,
  onChange,
}: {
  index: number;
  line: Line;
  slug: string | undefined;
  onChange: (change: Partial<Line>) => void;
}) {
  const sizes = useFetcher<QuotationLookup | null>();
  useEffect(() => {
    if (slug)
      void sizes.load(
        `/admin/quotations/lookup?product=${encodeURIComponent(slug)}`,
      );
  }, [slug]);
  const choices =
    slug && sizes.data && 'sizes' in sizes.data ? sizes.data.sizes : [];
  if (choices.length > 0) {
    const chosen =
      choices.find((c) => c.id === l.sizeId) ??
      choices.find(
        (c) => c.x === l.sizeX && c.y === l.sizeY && c.z === l.sizeZ,
      );
    return (
      <div className="sm:col-span-full sm:max-w-md">
        <SelectField
          label="Size"
          name={`line-${i}-size`}
          value={chosen?.id ?? ''}
          onChange={(e) => {
            const c = choices.find((x) => x.id === e.currentTarget.value);
            onChange(
              c
                ? {
                    sizeId: c.id,
                    sizeX: c.x,
                    sizeY: c.y,
                    sizeZ: c.z,
                    ...(c.unitPrice ? { unitPrice: c.unitPrice } : {}),
                  }
                : { sizeId: '', sizeX: '', sizeY: '', sizeZ: '' },
            );
          }}
        >
          <option value="">Choose a size…</option>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
              {c.unitPrice ? ` · $${c.unitPrice}` : ''}
            </option>
          ))}
        </SelectField>
      </div>
    );
  }
  return (
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
          onChange={(e) => onChange({ [key]: e.currentTarget.value })}
        />
      ))}
    </fieldset>
  );
}
