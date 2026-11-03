import {
  type GramsCost,
  type Page,
  STOCK_MOVEMENT_LABELS,
  type StockMovementCounts,
  type StockMovementKind,
  type StockMovementView,
  type StockOverview,
} from '@forgea/types';
import { Money } from '~/components/money';
import { FormAlert } from '~/components/ui/field';
import { AdminHeader, Panel } from '~/features/admin/admin-ui';
import { listState, pageQuery } from '~/features/admin/list-state';
import { formatRange, PeriodPicker } from '~/features/admin/period-picker';
import {
  ControlPanel,
  type ListColumn,
  ListView,
} from '~/features/admin/views';
import { stockOverview } from '~/features/stock/stock.server';
import {
  filament,
  grams,
  lineFilter,
  SignedGrams,
  movementFor,
  STOCK_TIME,
} from '~/features/stock/stock-ui';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

const DEFAULTS = { sorts: ['createdAt', 'grams'], order: 'desc' } as const;

const KINDS = Object.keys(STOCK_MOVEMENT_LABELS) as StockMovementKind[];

const GROUPS = [
  { key: 'kind', label: 'What' },
  { key: 'filament', label: 'Filament' },
];

type Row = StockMovementView;

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const state = listState(url.searchParams, DEFAULTS);
  const today = new Date().toISOString().slice(0, 10);
  const query = new URLSearchParams();
  for (const key of ['from', 'to']) {
    const value = url.searchParams.get(key);
    if (value) query.set(key, value);
  }
  const asked = query.size ? `?${query}` : '';
  let error: string | null = null;
  const first = await api.get<StockOverview>(`/stock${asked}`);
  let stock: StockOverview;
  if (first.ok) stock = first.data;
  else if (first.status === 400 && asked) {
    // A period the API refuses: say why and show the default one.
    error = first.message;
    stock = await stockOverview(api);
  } else throw new Response(first.message, { status: first.status });

  // One stock line's movements (from its page): a filter of its own, kept apart.
  const line = stock.items.find((i) =>
    state.filters.includes(lineFilter(i.id)),
  );
  const kinds = state.filters.filter((k): k is StockMovementKind =>
    KINDS.includes(k as StockMovementKind),
  );
  const list = pageQuery(state, 50);
  if (kinds.length > 0) list.set('kinds', kinds.join(','));
  if (line) list.set('stockItemId', line.id);
  const [page, counted] = await Promise.all([
    api.get<Page<StockMovementView>>(`/stock/movements?${list}`),
    api.get<StockMovementCounts>(
      `/stock/movements/counts${line ? `?stockItemId=${line.id}` : ''}`,
    ),
  ]);
  if (!page.ok) throw new Response(page.message, { status: page.status });
  const counts = counted.ok ? counted.data : {};
  const movements = {
    ...page.data,
    total: state.q
      ? undefined
      : (kinds.length > 0 ? kinds : KINDS).reduce(
          (n, k) => n + (counts[k] ?? 0),
          0,
        ),
  };
  return {
    state,
    movements,
    line: line ? { id: line.id, name: filament(line) } : null,
    counts,
    usage: stock.usage,
    costs: stock.costs,
    today,
    error,
  };
}

const filamentOf = (m: Row) =>
  `${m.materialCode} ${m.colour || '(any colour)'}`;

const COLUMNS: ListColumn<Row>[] = [
  {
    key: 'when',
    label: 'When',
    sort: 'createdAt',
    cell: (m) => (
      <span className="whitespace-nowrap">
        {STOCK_TIME.format(new Date(m.createdAt))}
      </span>
    ),
  },
  {
    key: 'kind',
    label: 'What',
    cell: (m) => (
      <span className="whitespace-nowrap">{STOCK_MOVEMENT_LABELS[m.kind]}</span>
    ),
  },
  {
    key: 'filament',
    label: 'Filament',
    cell: (m) => <span className="whitespace-nowrap">{filamentOf(m)}</span>,
  },
  {
    key: 'grams',
    label: 'Grams',
    sort: 'grams',
    align: 'right',
    cell: (m) => <SignedGrams value={m.grams} />,
  },
  {
    key: 'cost',
    label: 'Cost',
    align: 'right',
    cell: (m) => (m.cost !== null ? <Money amount={m.cost} /> : '—'),
  },
  { key: 'for', label: 'For', cell: movementFor },
  { key: 'by', label: 'By', cell: (m) => m.by ?? 'Automatic' },
];

const href = (m: Row) => `/admin/stock/${m.stockItemId}`;

export default function StockMovements({ loaderData }: Route.ComponentProps) {
  const { state, movements, line, counts, usage, costs, today, error } =
    loaderData;
  const filters = [
    ...KINDS.map((k) => ({
      key: k,
      label: STOCK_MOVEMENT_LABELS[k],
      count: counts[k] ?? 0,
    })),
    ...(line
      ? [{ key: lineFilter(line.id), label: line.name, apart: true }]
      : []),
  ];
  const groupOf =
    state.group === 'kind'
      ? (m: Row) => STOCK_MOVEMENT_LABELS[m.kind]
      : state.group === 'filament'
        ? filamentOf
        : undefined;
  return (
    <>
      <AdminHeader
        title="Filament movements"
        intro="Everything that came onto the shelf or went off it, newest first, and what the filament cost over a period."
        trail={[{ label: 'Filament stock', to: '/admin/stock' }]}
      />
      <FormAlert message={error ?? undefined} />

      <Panel title="Filament and its cost" className="mb-6">
        <PeriodPicker range={usage.range} today={today} />
        <p className="text-sm text-text-muted">
          {formatRange(usage.range)}. Studio and failed prints include machine
          time; orders’ filament is at its cost per gram when it went out.
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <CostTile title="Bought" value={costs.bought} />
          <CostTile title="Used by orders" value={costs.orders} />
          <CostTile title="Printed for the studio" value={costs.studio} />
          <CostTile title="Lost to failed prints" value={costs.failed} warn />
        </div>
        <h3 className="mt-2 text-sm font-semibold">
          Used by orders, by product
        </h3>
        {usage.rows.length === 0 ? (
          <p className="text-sm text-text-muted">
            No orders went into production then.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-text-muted">
                <tr>
                  <th className="py-2 pr-4 font-medium">Product</th>
                  <th className="py-2 pr-4 font-medium">Filament</th>
                  <th className="py-2 text-right font-medium">Used</th>
                </tr>
              </thead>
              <tbody>
                {usage.rows.map((r) => (
                  <tr
                    key={`${r.productId}:${r.materialCode}:${r.colour}`}
                    className="border-t border-border"
                  >
                    <td className="py-2 pr-4">{r.product}</td>
                    <td className="py-2 pr-4">
                      {r.materialCode} {r.colour || '(any colour)'}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {grams(r.grams)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <h2 className="mb-3 font-display text-lg font-bold">
        {line ? `Movements of ${line.name}` : 'Latest movements'}
      </h2>
      <ControlPanel
        state={state}
        search="Filament, product, order or note"
        filters={filters}
        groups={GROUPS}
        page={{
          shown: movements.items.length,
          total: movements.total,
          nextCursor: movements.nextCursor,
        }}
      />
      <ListView
        label="Latest movements"
        rows={movements.items}
        columns={COLUMNS}
        href={href}
        state={state}
        group={groupOf ? { of: groupOf } : undefined}
        empty="Nothing recorded yet."
      />
    </>
  );
}

function CostTile({
  title,
  value,
  warn = false,
}: {
  title: string;
  value: GramsCost;
  warn?: boolean;
}) {
  return (
    <div className="grid gap-1 rounded-md border border-border p-3">
      <p className="text-xs text-text-muted">{title}</p>
      <p
        className={`font-display text-xl font-bold tabular-nums ${warn && value.grams > 0 ? 'text-danger' : ''}`}
      >
        <Money amount={value.cost} />
      </p>
      <p className="text-xs text-text-muted tabular-nums">
        {grams(value.grams)}
      </p>
    </div>
  );
}
