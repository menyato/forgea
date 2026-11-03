import type { LeadStageView } from '@forgea/types';
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
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

const FILTERS = [
  { key: 'active', label: 'In use', only: 'active' },
  { key: 'archived', label: 'Not in use', only: 'active' },
  { key: 'won', label: 'Won stage', apart: true },
];

const DEFAULTS = {
  filters: ['active'],
  sorts: ['sortOrder', 'name', 'defaultProbability'],
  order: 'asc',
} as const;

export async function loader({ url, context }: Route.LoaderArgs) {
  const state = listState(url.searchParams, DEFAULTS);
  const r = await context.get(apiContext).get<LeadStageView[]>('/lead-stages');
  if (!r.ok) throw new Response(r.message, { status: r.status });
  const has = (key: string) => state.filters.includes(key);
  const stages = r.data.filter(
    (s) =>
      (!has('active') || s.active) &&
      (!has('archived') || !s.active) &&
      (!has('won') || s.isWon),
  );
  return {
    state,
    stages: localList(stages, state, {
      text: (s) => s.name,
      sorts: {
        sortOrder: (s) => s.sortOrder,
        name: (s) => s.name,
        defaultProbability: (s) => s.defaultProbability,
      },
    }),
  };
}

const COLUMNS: ListColumn<LeadStageView>[] = [
  { key: 'name', label: 'Stage', sort: 'name', cell: (s) => s.name },
  {
    key: 'order',
    label: 'Order',
    sort: 'sortOrder',
    align: 'right',
    cell: (s) => s.sortOrder,
  },
  {
    key: 'chance',
    label: 'Chance',
    sort: 'defaultProbability',
    align: 'right',
    cell: (s) => `${s.defaultProbability}%`,
  },
  { key: 'won', label: 'Won', cell: (s) => (s.isWon ? 'Won stage' : '—') },
  {
    key: 'active',
    label: 'In use',
    cell: (s) =>
      s.active ? 'Yes' : <span className="text-text-muted">No</span>,
  },
];

const href = (s: LeadStageView) => `/admin/lead-stages/${s.id}`;

export default function LeadStages({ loaderData }: Route.ComponentProps) {
  const { state, stages } = loaderData;
  const mayEdit = useCan()('pipeline.manage');
  return (
    <>
      <AdminHeader
        title="Lead stages"
        intro="The stages a lead goes through, in order. Moving a lead into the stage marked won wins it."
        action={
          mayEdit ? (
            <Link to="/admin/lead-stages/new" className={buttonClass()}>
              New stage
            </Link>
          ) : undefined
        }
      />
      <ControlPanel
        state={state}
        search="Stage name"
        filters={FILTERS}
        views={['list', 'kanban']}
        {...(state.view === 'list'
          ? {
              page: {
                shown: stages.items.length,
                total: stages.total,
                nextCursor: stages.nextCursor,
              },
            }
          : {})}
      />
      {state.view === 'kanban' ? (
        <KanbanView
          href={href}
          layout="grid"
          columns={[
            {
              key: 'all',
              title: 'Stages',
              // Cards stand in pipeline order, whatever the list is sorted by.
              items: [...stages.items].sort(
                (a, b) => a.sortOrder - b.sortOrder,
              ),
            },
          ]}
          title={(s) => s.name}
          card={(s) => (
            <span className="text-text-muted">
              Order {s.sortOrder} · {s.defaultProbability}% chance
              {s.isWon && ' · Won stage'}
              {!s.active && ' · Not in use'}
            </span>
          )}
        />
      ) : (
        <ListView
          label="Lead stages"
          rows={stages.items}
          columns={COLUMNS}
          href={href}
          state={state}
          empty="No stages here."
        />
      )}
    </>
  );
}
