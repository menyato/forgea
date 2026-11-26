import type { OrderSettings } from '@forgea/pricing';
import {
  type CheckoutResult,
  type CurrencyQuote,
  CustomRequestStatus,
  type CustomRequestView,
} from '@forgea/types';
import { CloseCustomRequestDto } from '@forgea/validation';
import { data, Form, redirect, useRouteLoaderData } from 'react-router';
import { Button } from '~/components/ui/button';
import { TextAreaField } from '~/components/ui/field';
import { text } from '~/features/admin/staff.server';
import { signInFor } from '~/features/auth/sign-in-links.server';
import { RequestForCustomer } from '~/features/custom-requests/request-for-customer';
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

  const open = r.status === CustomRequestStatus.QUOTED && !r.expired && r.quote;

  return (
    <RequestForCustomer
      request={r}
      store={store}
      notice={
        sent && (
          <p role="status" className="rounded-lg bg-surface p-4 font-medium">
            Request sent. We will reply with a quote here; you can also follow
            up on WhatsApp.
          </p>
        )
      }
      actions={
        <>
          {message && <p className="text-sm text-danger">{message}</p>}
          {r.status === CustomRequestStatus.QUOTED && (
            <CloseForm intent="decline" label="Decline the quote" />
          )}
          {r.status === CustomRequestStatus.SUBMITTED && (
            <CloseForm intent="cancel" label="Cancel the request" />
          )}
        </>
      }
      accept={
        open &&
        settings && (
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
        )
      }
    />
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
