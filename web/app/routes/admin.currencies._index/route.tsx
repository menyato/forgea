import type { CurrencyQuote } from '@forgea/types';
import { Link } from 'react-router';
import { buttonClass } from '~/components/ui/button';
import { AdminHeader } from '~/features/admin/admin-ui';
import { listState, localList } from '~/features/admin/list-state';
import {
  type ListColumn,
  ControlPanel,
  ListView,
} from '~/features/admin/views';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

const DEFAULTS = { sorts: ['code', 'name', 'since'], order: 'asc' } as const;

export async function loader({ url, context }: Route.LoaderArgs) {
  const state = listState(url.searchParams, DEFAULTS);
  const r = await context.get(apiContext).get<CurrencyQuote[]>('/currencies');
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return {
    state,
    currencies: localList(
      // US dollars are the base: every rate is per dollar.
      r.data.filter((c) => !c.isBase),
      state,
      {
        text: (c) => `${c.code} ${c.name}`,
        sorts: {
          code: (c) => c.code,
          name: (c) => c.name,
          since: (c) => c.rateEffectiveFrom ?? '',
        },
      },
    ),
  };
}

const COLUMNS: ListColumn<CurrencyQuote & { id: string }>[] = [
  { key: 'code', label: 'Code', sort: 'code', cell: (c) => c.code },
  { key: 'name', label: 'Currency', sort: 'name', cell: (c) => c.name },
  {
    key: 'rate',
    label: 'Per 1 USD',
    align: 'right',
    cell: (c) => Number(c.rate).toLocaleString('en-US'),
  },
  {
    key: 'since',
    label: 'Since',
    sort: 'since',
    cell: (c) => (
      <span className="text-text-muted">
        {c.rateEffectiveFrom
          ? new Date(c.rateEffectiveFrom).toLocaleString('en-GB')
          : '—'}
      </span>
    ),
  },
];

export default function Currencies({ loaderData }: Route.ComponentProps) {
  const { state, currencies } = loaderData;
  // The list's rows are keyed by currency code.
  const rows = currencies.items.map((c) => ({ ...c, id: c.code }));
  return (
    <>
      <AdminHeader
        title="Exchange rates"
        intro="Prices are set in US dollars. Customers can also pay in these currencies at the rate you set. Open one to set a new rate; every order keeps the rate it was placed at."
        action={
          <Link to="/admin/currencies/new" className={buttonClass('primary')}>
            New currency
          </Link>
        }
      />
      <ControlPanel
        state={state}
        search="Code or name"
        page={{
          shown: currencies.items.length,
          total: currencies.total,
          nextCursor: currencies.nextCursor,
        }}
      />
      <ListView
        label="Currencies"
        rows={rows}
        columns={COLUMNS}
        href={(c) => `/admin/currencies/${encodeURIComponent(c.code)}`}
        state={state}
        empty="No other currencies: prices are in US dollars only."
      />
    </>
  );
}
