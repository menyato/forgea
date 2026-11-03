import type { MaterialView } from '@forgea/types';
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
import {
  isLowStock,
  LowStockBadge,
  reelText,
} from '~/features/admin-materials/material-form';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

const FILTERS = [
  { key: 'active', label: 'In use', only: 'active' },
  { key: 'inactive', label: 'Not in use', only: 'active' },
  { key: 'low', label: 'Low stock', apart: true },
];

const DEFAULTS = {
  sorts: ['name', 'code', 'pricePerGram', 'stockGrams'],
  order: 'asc',
} as const;

export async function loader({ url, context }: Route.LoaderArgs) {
  const state = listState(url.searchParams, DEFAULTS);
  const r = await context.get(apiContext).get<MaterialView[]>('/materials');
  if (!r.ok) throw new Response(r.message, { status: r.status });
  const on = (key: string) => state.filters.includes(key);
  const items = r.data.filter(
    (m) =>
      (!on('active') || m.active) &&
      (!on('inactive') || !m.active) &&
      (!on('low') || isLowStock(m)),
  );
  return {
    state,
    materials: localList(
      items,
      state,
      {
        text: (m) => `${m.name} ${m.code}`,
        sorts: {
          name: (m) => m.name,
          code: (m) => m.code,
          pricePerGram: (m) => Number(m.pricePerGram),
          stockGrams: (m) => m.stockGrams,
        },
      },
      state.view === 'kanban' ? 200 : 50,
    ),
  };
}

const perGram = (m: MaterialView) => `$${Number(m.pricePerGram).toFixed(4)}`;

const COLUMNS: ListColumn<MaterialView>[] = [
  { key: 'name', label: 'Material', sort: 'name', cell: (m) => m.name },
  { key: 'code', label: 'Code', sort: 'code', cell: (m) => m.code },
  {
    key: 'pricePerGram',
    label: 'A gram costs',
    sort: 'pricePerGram',
    align: 'right',
    cell: perGram,
  },
  {
    key: 'reel',
    label: 'Reel',
    cell: (m) => <span className="text-text-muted">{reelText(m) ?? '—'}</span>,
  },
  {
    key: 'stockGrams',
    label: 'On the shelf',
    sort: 'stockGrams',
    align: 'right',
    cell: (m) => (
      <span className="inline-flex items-center gap-2">
        {isLowStock(m) && <LowStockBadge />}
        {m.stockGrams.toLocaleString('en-US')} g
      </span>
    ),
  },
  {
    key: 'prints',
    label: 'Prints',
    align: 'right',
    cell: (m) => `${m.gramsPerHour} g/h`,
  },
  {
    key: 'active',
    label: 'In use',
    cell: (m) =>
      m.active ? 'Yes' : <span className="text-text-muted">Not in use</span>,
  },
];

const href = (m: MaterialView) => `/admin/materials/${m.id}`;

export default function Materials({ loaderData }: Route.ComponentProps) {
  const { state, materials } = loaderData;
  const mayAdd = useCan()('materials.manage');
  return (
    <>
      <AdminHeader
        title="Materials"
        intro="Each material you print with: what a gram costs you (from the spools you buy) and how dense and fast it prints. Products are priced from it, and grams and hours are estimated from 3D models with it. Spools in and out are recorded on the Stock page."
        action={
          mayAdd ? (
            <Link to="/admin/materials/new" className={buttonClass()}>
              New material
            </Link>
          ) : undefined
        }
      />
      <ControlPanel
        state={state}
        search="Name or code"
        filters={FILTERS}
        views={['list', 'kanban']}
        {...(state.view === 'list'
          ? {
              page: {
                shown: materials.items.length,
                total: materials.total,
                nextCursor: materials.nextCursor,
              },
            }
          : {})}
      />
      {state.view === 'kanban' ? (
        <KanbanView
          href={href}
          layout="grid"
          columns={[{ key: 'all', title: 'Materials', items: materials.items }]}
          title={(m) => `${m.name} · ${m.code}`}
          card={(m) => (
            <>
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold tabular-nums">
                  {perGram(m)} a gram
                </span>
                {isLowStock(m) && <LowStockBadge />}
              </span>
              {reelText(m) && (
                <span className="text-text-muted">{reelText(m)}</span>
              )}
              <span className="flex justify-between text-text-muted">
                <span className="tabular-nums">
                  {m.stockGrams.toLocaleString('en-US')} g on the shelf
                </span>
                {!m.active && <span>Not in use</span>}
              </span>
            </>
          )}
        />
      ) : (
        <ListView
          label="Materials"
          rows={materials.items}
          columns={COLUMNS}
          href={href}
          state={state}
          empty={
            mayAdd
              ? 'No materials here. Add one with New material.'
              : 'No materials here.'
          }
        />
      )}
    </>
  );
}
