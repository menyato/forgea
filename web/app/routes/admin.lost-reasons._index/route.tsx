import type { LostReasonView } from '@forgea/types';
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
];

const DEFAULTS = {
  filters: ['active'],
  sorts: ['name'],
  order: 'asc',
} as const;

export async function loader({ url, context }: Route.LoaderArgs) {
  const state = listState(url.searchParams, DEFAULTS);
  const r = await context
    .get(apiContext)
    .get<LostReasonView[]>('/lost-reasons');
  if (!r.ok) throw new Response(r.message, { status: r.status });
  const has = (key: string) => state.filters.includes(key);
  const reasons = r.data.filter(
    (x) => (!has('active') || x.active) && (!has('archived') || !x.active),
  );
  return {
    state,
    reasons: localList(reasons, state, {
      text: (x) => x.name,
      sorts: { name: (x) => x.name },
    }),
  };
}

const COLUMNS: ListColumn<LostReasonView>[] = [
  { key: 'name', label: 'Reason', sort: 'name', cell: (x) => x.name },
  {
    key: 'active',
    label: 'In use',
    cell: (x) =>
      x.active ? 'Yes' : <span className="text-text-muted">No</span>,
  },
];

const href = (x: LostReasonView) => `/admin/lost-reasons/${x.id}`;

export default function LostReasons({ loaderData }: Route.ComponentProps) {
  const { state, reasons } = loaderData;
  const mayEdit = useCan()('pipeline.manage');
  return (
    <>
      <AdminHeader
        title="Lost reasons"
        intro="Why some leads are lost: the team picks one when they close a lead without a sale."
        action={
          mayEdit ? (
            <Link to="/admin/lost-reasons/new" className={buttonClass()}>
              New reason
            </Link>
          ) : undefined
        }
      />
      <ControlPanel
        state={state}
        search="Reason"
        filters={FILTERS}
        views={['list', 'kanban']}
        {...(state.view === 'list'
          ? {
              page: {
                shown: reasons.items.length,
                total: reasons.total,
                nextCursor: reasons.nextCursor,
              },
            }
          : {})}
      />
      {state.view === 'kanban' ? (
        <KanbanView
          href={href}
          layout="grid"
          columns={[{ key: 'all', title: 'Reasons', items: reasons.items }]}
          title={(x) => x.name}
          card={(x) => (
            <span className="text-text-muted">
              {x.active ? 'In use' : 'Not in use'}
            </span>
          )}
        />
      ) : (
        <ListView
          label="Lost reasons"
          rows={reasons.items}
          columns={COLUMNS}
          href={href}
          state={state}
          empty="No lost reasons here."
        />
      )}
    </>
  );
}
