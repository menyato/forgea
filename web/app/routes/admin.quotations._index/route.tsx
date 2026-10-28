import {
  type Page,
  type QuotationListItem,
  QuotationStatus,
} from '@forgea/types';
import { Link, useSearchParams } from 'react-router';
import { Money } from '~/components/money';
import { buttonClass } from '~/components/ui/button';
import { AdminHeader } from '~/features/admin/admin-ui';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ url, context }: Route.LoaderArgs) {
  const query = new URLSearchParams({ limit: '100' });
  const status = url.searchParams.get('status');
  if (status) query.set('status', status);
  const r = await context
    .get(apiContext)
    .get<Page<QuotationListItem>>(`/quotations?${query}`);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { quotations: r.data.items };
}

const LABELS: Record<QuotationStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
};

export default function Quotations({ loaderData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const status = params.get('status');
  return (
    <>
      <AdminHeader
        title="Quotations"
        intro="Prices you write for a customer. Send one and they can accept it online; confirming it creates the order."
        action={
          <Link to="/admin/quotations/new" className={buttonClass()}>
            Write a quotation
          </Link>
        }
      />
      <nav aria-label="Quotation status" className="mb-6 flex flex-wrap gap-2">
        {[null, ...Object.values(QuotationStatus)].map((s) => (
          <Link
            key={s ?? 'all'}
            to={s ? `?status=${s}` : '?'}
            aria-current={status === s ? 'page' : undefined}
            className={`rounded-pill border px-3 py-1 text-sm ${
              status === s
                ? 'border-accent bg-accent text-on-accent'
                : 'border-border text-text-muted hover:text-text'
            }`}
          >
            {s ? LABELS[s] : 'All'}
          </Link>
        ))}
      </nav>
      {loaderData.quotations.length === 0 ? (
        <p className="text-text-muted">No quotations here.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="text-left text-text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Valid until</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {loaderData.quotations.map((q) => (
                <tr key={q.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <Link
                      to={`/admin/quotations/${q.id}`}
                      className="font-mono font-semibold hover:underline"
                    >
                      {q.number}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {q.customer.name ?? q.customer.email}
                  </td>
                  <td className="px-4 py-3">
                    {q.expired ? 'Expired' : LABELS[q.status]}
                    {q.orderNumber && (
                      <span className="block font-mono text-xs text-text-muted">
                        {q.orderNumber}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{q.validUntil}</td>
                  <td className="px-4 py-3 text-right">
                    <Money amount={q.total} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
