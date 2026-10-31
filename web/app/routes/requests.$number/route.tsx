import type { OrderSettings } from '@forgea/pricing';
import {
  type CheckoutResult,
  type CurrencyQuote,
  CUSTOM_REQUEST_STATUS_LABELS,
  CustomRequestStatus,
  type CustomRequestView,
} from '@forgea/types';
import { CloseCustomRequestDto } from '@forgea/validation';
import { data, Form, Link, redirect, useRouteLoaderData } from 'react-router';
import { PAGE_WIDTH } from '~/components/layout/page-width';
import { Money } from '~/components/money';
import { Button } from '~/components/ui/button';
import { TextAreaField } from '~/components/ui/field';
import { text } from '~/features/admin/staff.server';
import { signInFor } from '~/features/auth/sign-in-links.server';
import { WhatsAppLink } from '~/features/contact/whatsapp-link';
import { RequestFileView } from '~/features/custom-requests/request-file-view';
import { RequestTimeline } from '~/features/custom-requests/request-timeline';
import { OrderConfirmation } from '~/features/orders/order-confirmation';
import { OrderForm } from '~/features/orders/order-form';
import { parseOrderForm } from '~/features/orders/order-form.server';
import { validateForm } from '~/lib/forms.server';
import { apiContext } from '~/lib/request.server';
import type { loader as rootLoader } from '~/root';
import type { Route } from './+types/route';

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: loaderData
        ? `${loaderData.request.title} — Forgea`
        : 'Request — Forgea',
    },
  ];
}

export async function loader({ params, url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  if (!api.hasSession) throw redirect(signInFor(url));
  const path = `/custom-requests/mine/${encodeURIComponent(params.number)}`;
  const [request, settings, currencies] = await Promise.all([
    api.get<CustomRequestView>(path),
    api.get<OrderSettings>('/pricing/order-settings'),
    api.get<CurrencyQuote[]>('/currencies'),
  ]);
  if (request.status === 401) throw redirect(signInFor(url));
  if (!request.ok)
    throw new Response(request.message, { status: request.status });
  return {
    request: request.data,
    settings: settings.ok ? settings.data : null,
    currencies: currencies.ok ? currencies.data : [],
    sent: url.searchParams.has('sent'),
    idempotencyKey: crypto.randomUUID(),
  };
}

/** accept (places the order) | decline | cancel */
export async function action({
  request,
  params,
  url,
  context,
}: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const intent = form.get('intent');
  const base = `/custom-requests/mine/${encodeURIComponent(params.number)}`;

  if (intent === 'decline' || intent === 'cancel') {
    const parsed = validateForm(CloseCustomRequestDto, {
      note: text(form, 'note'),
    });
    if (!parsed.ok)
      return data({ message: 'The note is too long' }, { status: 400 });
    const r = await api.post(`${base}/${intent}`, parsed.value);
    if (r.status === 401) throw redirect(signInFor(url));
    return r.ok
      ? { message: undefined }
      : data({ message: r.message }, { status: r.status });
  }

  const parsed = parseOrderForm(form);
  if (!parsed.ok) {
    return data({ errors: parsed.errors, message: undefined }, { status: 400 });
  }
  const r = await api.post<CheckoutResult>(`${base}/accept`, {
    ...parsed.value,
    quotedPrice: form.get('quotedPrice'),
  });
  if (r.status === 401) throw redirect(signInFor(url));
  if (!r.ok)
    return data({ errors: {}, message: r.message }, { status: r.status });
  return { result: r.data };
}

export default function RequestPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { request: r, settings, currencies, sent, idempotencyKey } = loaderData;
  const store = useRouteLoaderData<typeof rootLoader>('root')?.store ?? null;
  const message =
    actionData && 'message' in actionData ? actionData.message : undefined;

  if (actionData && 'result' in actionData && actionData.result) {
    return (
      <OrderConfirmation
        result={actionData.result}
        currencies={currencies}
        store={store}
      />
    );
  }

  const status = r.expired
    ? {
        title: 'Quote expired',
        detail: 'Ask us on WhatsApp and we will send a new one.',
      }
    : CUSTOM_REQUEST_STATUS_LABELS[r.status];
  const open = r.status === CustomRequestStatus.QUOTED && !r.expired && r.quote;

  return (
    <main className={`${PAGE_WIDTH} grid gap-10 py-10`}>
      {sent && (
        <p role="status" className="rounded-lg bg-surface p-4 font-medium">
          Request sent. We will reply with a quote here; you can also follow up
          on WhatsApp.
        </p>
      )}
      <header className="grid gap-3">
        <Link
          to="/requests"
          className="text-sm text-text-muted hover:underline"
        >
          My requests
        </Link>
        <h1 className="font-display text-[clamp(2.25rem,4vw,3.5rem)] leading-none font-extrabold tracking-tight">
          {r.title}
        </h1>
        <p className="text-text-muted">
          {r.requestNumber} · {status.title}. {status.detail}
        </p>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(20rem,5fr)]">
        <section className="grid content-start gap-6">
          {r.design && (
            <figure className="grid gap-2">
              <RequestFileView
                file={r.design}
                label={`our design for ${r.title}`}
              />
              <figcaption className="text-sm text-text-muted">
                Our design
              </figcaption>
            </figure>
          )}
          {r.file && (
            <figure className="grid gap-2">
              <RequestFileView file={r.file} label="your file" />
              <figcaption className="text-sm text-text-muted">
                What you sent
              </figcaption>
            </figure>
          )}
          <p className="max-w-[65ch] whitespace-pre-line">{r.description}</p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1 text-sm">
            <dt className="text-text-muted">How many</dt>
            <dd>{r.quantity}</dd>
            {r.material && (
              <>
                <dt className="text-text-muted">Material</dt>
                <dd>{r.material.name}</dd>
              </>
            )}
            {r.colour && (
              <>
                <dt className="text-text-muted">Colour</dt>
                <dd>{r.colour}</dd>
              </>
            )}
            {r.estimate && (
              <>
                <dt className="text-text-muted">Instant estimate</dt>
                <dd>
                  <Money amount={r.estimate.low} />–
                  <Money amount={r.estimate.high} />
                </dd>
              </>
            )}
          </dl>
        </section>

        <aside className="grid content-start gap-6">
          {r.quote && (
            <div className="grid gap-2 rounded-lg bg-surface p-5">
              <p className="text-sm text-text-muted">Our quote</p>
              <p className="font-display text-4xl font-extrabold">
                <Money amount={r.quote.price} />
              </p>
              {r.quote.note && <p>{r.quote.note}</p>}
              <p className="text-sm text-text-muted">
                {r.expired ? 'Expired' : 'Valid until'}{' '}
                {new Date(r.quote.expiresAt).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'long',
                })}
              </p>
            </div>
          )}
          {r.orderNumber && (
            <p>
              Order{' '}
              <Link to="/orders" className="font-mono font-semibold underline">
                {r.orderNumber}
              </Link>{' '}
              was created from this request.
            </p>
          )}
          {message && <p className="text-sm text-danger">{message}</p>}
          {r.status === CustomRequestStatus.QUOTED && (
            <CloseForm intent="decline" label="Decline the quote" />
          )}
          {r.status === CustomRequestStatus.SUBMITTED && (
            <CloseForm intent="cancel" label="Cancel the request" />
          )}
          {store && (
            <WhatsAppLink
              phone={store.whatsappPhone}
              message={`Hello Forgea! About request ${r.requestNumber}.`}
              className="text-sm underline underline-offset-4"
            >
              Chat about this request on WhatsApp
            </WhatsAppLink>
          )}
          <RequestTimeline history={r.history} />
        </aside>
      </div>

      {open && settings && (
        <section aria-labelledby="accept-heading" className="grid gap-6">
          <h2 id="accept-heading" className="font-display text-3xl font-bold">
            Accept and order
          </h2>
          <OrderForm
            lines={[
              {
                id: r.requestNumber,
                name: `Custom: ${r.title}`,
                unitPrice: r.quote!.price,
                quantity: 1,
                isCustom: true,
              },
            ]}
            settings={settings}
            currencies={currencies}
            initial={{ delivery: true, rush: false, currency: 'USD' }}
            idempotencyKey={idempotencyKey}
            errors={
              actionData && 'errors' in actionData && actionData.errors
                ? actionData.errors
                : {}
            }
            message={undefined}
            allowRush={false}
            hidden={{ quotedPrice: r.quote!.price }}
            submitLabel="Accept and place the order"
          />
        </section>
      )}
    </main>
  );
}

function CloseForm({
  intent,
  label,
}: {
  intent: 'decline' | 'cancel';
  label: string;
}) {
  return (
    <Form method="post" className="grid gap-3">
      <input type="hidden" name="intent" value={intent} />
      <TextAreaField
        label="Anything to tell us? (optional)"
        name="note"
        rows={2}
      />
      <Button type="submit" variant="secondary" className="justify-self-start">
        {label}
      </Button>
    </Form>
  );
}
