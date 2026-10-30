import {
  type Page,
  type QuotationListItem,
  QuotationStatus,
} from '@forgea/types';
import { Link, useSearchParams } from 'react-router';
import { Money } from '~/components/money';
import { buttonClass } from '~/components/ui/button';
import { useCan } from '~/features/admin/access';
import { AdminHeader } from '~/features/admin/admin-ui';
import {
  Board,
  BoardCard,
  ViewSwitch,
  ViewTabs,
  viewMode,
} from '~/features/admin/views';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ url, context }: Route.LoaderArgs) {
  const query = new URLSearchParams({ limit: '100' });
  const status = url.searchParams.get('status');
  const board = viewMode(url.searchParams) === 'board';
  if (
    !board &&
    Object.values(QuotationStatus).includes(status as QuotationStatus)
  )
    query.set('status', status!);
  const api = context.get(apiContext);
  const [r, counts] = await Promise.all([
    api.get<Page<QuotationListItem>>(`/quotations?${query}`),
    api.get<Partial<Record<QuotationStatus, number>>>('/quotations/counts'),
  ]);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { quotations: r.data.items, counts: counts.ok ? counts.data : {} };
}

const LABELS: Record<QuotationStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
};

export default function Quotations({ loaderData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const status = params.get('status') ?? 'all';
  const mode = viewMode(params);
  const { counts } = loaderData;
  const mayWrite = useCan()('quotations.manage');
  return (
    <>
      <AdminHeader
        title="Quotations"
        intro="Prices you write for a customer. Send one and they can accept it online; confirming it creates the order."
        action={
          <div className="flex flex-wrap items-center gap-3">
            <ViewSwitch current={mode} />
            {mayWrite && (
              <Link to="/admin/quotations/new" className={buttonClass()}>
                Write a quotation
              </Link>
            )}
          </div>
        }
      />
      {mode === 'board' ? (
        <Board
          columns={(['DRAFT', 'SENT', 'CONFIRMED'] as const).map((st) => ({
            key: st,
            title: LABELS[st],
            items: loaderData.quotations.filter((q) => q.status === st),
          }))}
          card={(q) => (
            <BoardCard to={`/admin/quotations/${q.id}`} title={q.number}>
              <span className="text-text-muted">
                {q.customer.name ?? q.customer.email}
              </span>
              <span className="flex justify-between">
                <Money amount={q.total} />
                {q.expired && <span className="text-warning">expired</span>}
              </span>
            </BoardCard>
          )}
        />
      ) : (
        <>
          <ViewTabs
            label="Quotation status"
            param="status"
            current={status}
            tabs={[
              { key: 'all', label: 'All' },
              ...Object.values(QuotationStatus).map((st) => ({
                key: st,
                label: LABELS[st],
                ...(st === 'DRAFT' || st === 'SENT'
                  ? { count: counts[st] ?? 0 }
                  : {}),
              })),
            ]}
          />
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
                        {q.customer.id === null && (
                          <span className="block text-xs text-text-muted">
                            no account yet · by email
                          </span>
                        )}
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
      )}
    </>
  );
}
