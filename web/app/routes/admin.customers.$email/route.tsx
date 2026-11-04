import {
  CUSTOM_REQUEST_STATUS_LABELS,
  type CustomerDetail,
  ORDER_STATUS_LABELS,
} from '@forgea/types';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Money } from '~/components/money';
import { WhatsAppLink } from '~/features/contact/whatsapp-link';
import { AdminHeader, Panel } from '~/features/admin/admin-ui';
import { accountText } from '~/features/customers/account-text';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: `${loaderData?.customer.name ?? loaderData?.customer.email ?? 'Customer'} — Forgea`,
    },
  ];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const r = await context
    .get(apiContext)
    .get<CustomerDetail>(
      `/customers/one?email=${encodeURIComponent(params.email)}`,
    );
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { customer: r.data };
}

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

/** One kind of record they have, newest first, each opening its own page. */
function History<T>({
  title,
  rows,
  empty,
  row,
}: {
  title: string;
  rows: readonly T[];
  empty: string;
  row: (item: T) => {
    key: string;
    to: string;
    label: string;
    detail: ReactNode;
  };
}) {
  return (
    <Panel title={`${title} (${rows.length})`}>
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">{empty}</p>
      ) : (
        <ul className="grid gap-1 text-sm">
          {rows.map((item) => {
            const r = row(item);
            return (
              <li key={r.key} className="flex flex-wrap gap-x-2">
                <Link to={r.to} className="font-mono underline">
                  {r.label}
                </Link>
                <span className="text-text-muted">{r.detail}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export default function Customer({ loaderData }: Route.ComponentProps) {
  const { customer: c } = loaderData;
  return (
    <>
      <AdminHeader
        trail={[{ label: 'Customers', to: '/admin/customers' }]}
        title={c.name ?? c.email}
        intro={`${c.email}${c.phone ? ` · ${c.phone}` : ''} · ${accountText(c)}${c.account ? ` since ${date(c.account.since)}${c.account.confirmed ? '' : ' (address not confirmed)'}` : ''}`}
      />
      <div className="mb-6 flex flex-wrap gap-6 text-sm">
        <p>
          <strong className="text-2xl">{c.orders}</strong> order
          {c.orders === 1 ? '' : 's'}
        </p>
        <p>
          <strong className="text-2xl">
            <Money amount={c.spent} />
          </strong>{' '}
          spent
        </p>
        <p>Last activity {date(c.lastActivity)}</p>
        {c.cart && (
          <p>
            {c.cart.lines} item{c.cart.lines === 1 ? '' : 's'} in their cart (
            {date(c.cart.updatedAt)})
          </p>
        )}
        {c.phone && (
          <WhatsAppLink
            phone={c.phone}
            message={`Hello ${c.name ?? ''}, this is Forgea.`}
            className="underline underline-offset-4"
          >
            Message on WhatsApp
          </WhatsAppLink>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <History
          title="Orders"
          rows={c.history.orders}
          empty={c.account ? 'No orders yet.' : 'No account, so no orders yet.'}
          row={(o) => ({
            key: o.id,
            to: `/admin/orders/${o.id}`,
            label: o.number,
            detail: (
              <>
                {ORDER_STATUS_LABELS[o.status].title} ·{' '}
                <Money amount={o.total} /> · {date(o.createdAt)}
              </>
            ),
          })}
        />
        <History
          title="Quotations"
          rows={c.history.quotations}
          empty="No quotations."
          row={(q) => ({
            key: q.id,
            to: `/admin/quotations/${q.id}`,
            label: q.number,
            detail: (
              <>
                {q.status.toLowerCase()} · <Money amount={q.total} /> ·{' '}
                {date(q.createdAt)}
              </>
            ),
          })}
        />
        <History
          title="Custom requests"
          rows={c.history.requests}
          empty="No custom requests."
          row={(r) => ({
            key: r.id,
            to: `/admin/requests/${r.id}`,
            label: r.number,
            detail: `${r.title} · ${CUSTOM_REQUEST_STATUS_LABELS[r.status].title} · ${date(r.createdAt)}`,
          })}
        />
        <History
          title="Leads"
          rows={c.history.leads}
          empty="No leads."
          row={(l) => ({
            key: l.id,
            to: `/admin/leads/${l.id}`,
            label: l.name,
            detail: `${l.state === 'open' ? l.stage : l.state} · ${date(l.createdAt)}`,
          })}
        />
      </div>
    </>
  );
}
