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
    { name: 'robots', content: 'noindex' },
  ];
}

/** A quotation on the customer's own account (the emailed link is /q/<token>). */
export async function loader({ params, url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  if (!api.hasSession) throw redirect(signInFor(url));
  const q = await api.get<QuotationDetail>(
    `/quotations/mine/${encodeURIComponent(params.number)}`,
  );
  if (q.status === 401) throw redirect(signInFor(url));
  if (!q.ok) throw new Response(q.message, { status: q.status });
  return { quotation: q.data, ...(await quotationExtras(api, q.data)) };
}

/** accept (places the order) | decline (with an optional reason) */
export async function action({
  request,
  params,
  url,
  context,
}: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const base = `/quotations/mine/${encodeURIComponent(params.number)}`;
  if (form.get('intent') === 'decline') {
    const r = await api.post<QuotationDetail>(
      `${base}/decline`,
      declineBody(form),
    );
    if (r.status === 401) throw redirect(signInFor(url));
    return r.ok
      ? { result: null, error: null }
      : data({ result: null, error: r.message }, { status: r.status });
  }
  const seen = form.get('seen');
  const r = await api.post<CheckoutResult>(
    `${base}/accept`,
    typeof seen === 'string' && seen ? { seen } : {},
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
  return (
    <QuotationDocument
      {...loaderData}
      result={actionData?.result}
      error={actionData?.error}
    />
  );
}
