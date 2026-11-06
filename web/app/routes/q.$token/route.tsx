import type { CheckoutResult, QuotationDetail } from '@forgea/types';
import { data, redirect } from 'react-router';
import { signInFor } from '~/features/auth/sign-in-links.server';
import { QuotationDocument } from '~/features/quotations/quotation-document';
import { declineBody } from '~/features/quotations/decline.server';
import { quotationExtras } from '~/features/quotations/quotation-extras.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: loaderData
        ? `Quotation ${loaderData.quotation.number} — Forgea`
        : 'Quotation — Forgea',
    },
    // A private link: never indexed, never sent on as a referrer.
    { name: 'robots', content: 'noindex' },
    { name: 'referrer', content: 'no-referrer' },
  ];
}

/** The link in the quotation email: opens it without an account. */
export async function loader({ params, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const q = await api.get<QuotationDetail>(
    `/quotations/link/${encodeURIComponent(params.token)}`,
  );
  if (!q.ok) throw new Response(q.message, { status: q.status });
  return {
    quotation: q.data,
    signedIn: api.hasSession,
    ...(await quotationExtras(api, q.data)),
  };
}

/**
 * Accepting places an order, which needs an account with the address it was sent to.
 * Declining commits them to nothing: no account needed.
 */
export async function action({
  request,
  params,
  url,
  context,
}: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  if (form.get('intent') === 'decline') {
    const r = await api.post<QuotationDetail>(
      `/quotations/link/${encodeURIComponent(params.token)}/decline`,
      declineBody(form),
    );
    return r.ok
      ? { result: null, error: null }
      : data({ result: null, error: r.message }, { status: r.status });
  }
  if (!api.hasSession) throw redirect(signInFor(url));
  const seen = form.get('seen');
  const r = await api.post<CheckoutResult>(
    `/quotations/link/${encodeURIComponent(params.token)}/accept`,
    typeof seen === 'string' && seen ? { seen } : {},
  );
  if (r.status === 401) throw redirect(signInFor(url));
  return r.ok
    ? { result: r.data, error: null }
    : data({ result: null, error: r.message }, { status: r.status });
}

export default function QuotationLinkPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { signedIn, ...rest } = loaderData;
  return (
    <QuotationDocument
      {...rest}
      result={actionData?.result}
      error={actionData?.error}
      signInNote={
        signedIn
          ? undefined
          : `To accept, you will sign in or create a free account with ${rest.quotation.customer.email}; you come straight back here.`
      }
    />
  );
}
