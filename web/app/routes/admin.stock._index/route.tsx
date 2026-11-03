import type { StockItemView } from '@forgea/types';
import { Link } from 'react-router';
import { buttonClass } from '~/components/ui/button';
import { useCan } from '~/features/admin/access';
import { AdminHeader } from '~/features/admin/admin-ui';
import { listState, localList } from '~/features/admin/list-state';
import {
  ControlPanel,
  KanbanView,
  type ListColumn,
  ListView,
} from '~/features/admin/views';
import { stockOverview } from '~/features/stock/stock.server';
import {
  filament,
  grams,
  STOCK_ACTIONS,
  STOCK_TIME,
  StockBadge,
  StockMeter,
  Swatch,
} from '~/features/stock/stock-ui';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

const DEFAULTS = {
  sorts: ['filament', 'stock', 'available', 'days'],
  order: 'asc',
} as const;

const GROUPS = [{ key: 'material', label: 'Material' }];

type Line = StockItemView;

export async function loader({ url, context }: Route.LoaderArgs) {
  const state = listState(url.searchParams, DEFAULTS);
  const stock = await stockOverview(context.get(apiContext));
  const all: Line[] = stock.items;
  const low = all.filter((i) => i.needsRestock);
  const tracked = all.filter((i) => i.active);
  const filtered = all.filter(
    (i) =>
      (!state.filters.includes('low') || i.needsRestock) &&
      (!state.filters.includes('tracked') || i.active) &&
      (!state.filters.includes('untracked') || !i.active),
  );
  const lines = localList(
    filtered,
    state,
    {
      text: (i) => `${i.material.code} ${i.material.name} ${i.colour}`,
      sorts: {
        filament: (i) => filament(i).toLowerCase(),
        stock: (i) => i.stockGrams,
        available: (i) => i.availableGrams,
        days: (i) => i.daysLeft ?? Number.MAX_SAFE_INTEGER,
      },
    },
    state.view === 'kanban' ? 500 : 50,
  );
  return {
    state,
    lines,
    empty: all.length === 0,
    counts: {
      low: low.length,
      tracked: tracked.length,
      untracked: all.length - tracked.length,
    },
  };
}

const COLUMNS: ListColumn<Line>[] = [
  {
    key: 'filament',
    label: 'Filament',
    sort: 'filament',
    cell: (i) => (
      <span className="inline-flex items-center gap-2">
        <Swatch hex={i.swatchHex} />
        {filament(i)}
      </span>
    ),
  },
  { key: 'material', label: 'Material', cell: (i) => i.material.name },
  {
    key: 'stock',
    label: 'On the shelf',
    sort: 'stock',
    align: 'right',
    cell: (i) => grams(i.stockGrams),
  },
  {
    key: 'available',
    label: 'Available',
    sort: 'available',
    align: 'right',
    cell: (i) => grams(i.availableGrams),
  },
  {
    key: 'limit',
    label: 'Restock at',
    align: 'right',
    cell: (i) => grams(i.reorderPointGrams),
  },
  {
    key: 'days',
    label: 'Lasts',
    sort: 'days',
    align: 'right',
    cell: (i) => (i.daysLeft === null ? '—' : `${i.daysLeft} days`),
  },
  {
    key: 'status',
    label: 'Status',
    cell: (i) => (
      <span className="inline-flex flex-wrap items-center gap-2">
        <StockBadge item={i} />
        {i.active && i.needsRestock && (
          <span className="text-xs text-text-muted">
            buy {i.suggestSpools} spool{i.suggestSpools === 1 ? '' : 's'} (
            {grams(i.suggestGrams)})
          </span>
        )}
      </span>
    ),
  },
  {
    key: 'moved',
    label: 'Last movement',
    cell: (i) => (
      <span className="whitespace-nowrap text-text-muted">
        {i.lastMovedAt ? STOCK_TIME.format(new Date(i.lastMovedAt)) : '—'}
      </span>
    ),
  },
];

const href = (i: Line) => `/admin/stock/${i.id}`;

export default function Stock({ loaderData }: Route.ComponentProps) {
  const { state, lines, empty, counts } = loaderData;
  const manage = useCan()('stock.manage');
  const filters = [
    { key: 'low', label: 'Low stock', count: counts.low, apart: true },
    {
      key: 'tracked',
      label: 'Tracked',
      count: counts.tracked,
      only: 'active',
    },
    {
      key: 'untracked',
      label: 'Not tracked',
      count: counts.untracked,
      only: 'active',
    },
  ];
  const byMaterial = (i: Line) => `${i.material.name} (${i.material.code})`;
  const materials = [...new Set(lines.items.map(byMaterial))];
  return (
    <>
      <AdminHeader
        title="Filament stock"
        intro="Every material in every colour on the shelf. Record what comes in and what goes out in a few taps: grams and costs are worked out from your spools and your products. Orders take their filament by themselves when they go into production."
        action={
          <>
            {manage &&
              STOCK_ACTIONS.map((a) => (
                <Link key={a.path} to={a.path} className={buttonClass()}>
                  {a.label}
                </Link>
              ))}
            <Link
              to="/admin/stock/movements"
              className={buttonClass('secondary')}
            >
              Movements
            </Link>
          </>
        }
      />
      <ControlPanel
        state={state}
        search="Material or colour"
        filters={filters}
        groups={GROUPS}
        views={['list', 'kanban']}
        {...(state.view === 'list'
          ? {
              page: {
                shown: lines.items.length,
                total: lines.total,
                nextCursor: lines.nextCursor,
              },
            }
          : {})}
      />
      {empty ? (
        <p className="text-text-muted">
          No filament recorded yet: start with the spools you have (Spools
          received, or Weigh the spools).
        </p>
      ) : state.view === 'kanban' ? (
        <KanbanView
          href={href}
          columns={materials.map((m) => ({
            key: m,
            title: m,
            items: lines.items.filter((i) => byMaterial(i) === m),
          }))}
          title={filament}
          card={(i) => (
            <>
              <span className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 font-display text-xl font-bold tabular-nums">
                  <Swatch hex={i.swatchHex} />
                  {grams(i.stockGrams)}
                </span>
                <StockBadge item={i} />
              </span>
              <StockMeter item={i} />
              <span
                className={`text-xs ${i.needsRestock ? 'font-semibold text-warning' : 'text-text-muted'}`}
              >
                {grams(i.availableGrams)} available
                {i.daysLeft !== null && ` · about ${i.daysLeft} days`} · restock
                at {grams(i.reorderPointGrams)}
              </span>
            </>
          )}
        />
      ) : (
        <ListView
          label="Filament stock"
          rows={lines.items}
          columns={COLUMNS}
          href={href}
          state={state}
          group={state.group === 'material' ? { of: byMaterial } : undefined}
          empty="No filament matches."
        />
      )}
      <p className="mt-4 text-xs text-text-muted">
        Available = on the shelf − what orders not yet in production will take.
        Daily use is the busier of the last 30 and 90 days; restock comes at
        your low level plus what is used while a delivery comes.
      </p>
    </>
  );
}
