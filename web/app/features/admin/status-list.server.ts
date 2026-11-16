import type { Page } from '@forgea/types';
import type { ApiClient } from '~/lib/api-client.server';
import { type ListState, pageQuery } from './list-state';

/**
 * A page of a list whose records move through statuses (orders, custom requests,
 * quotations), with the counts by status: the filters picked, or on the kanban with none
 * picked the statuses still `open`; how many the pager can promise; the kanban's columns.
 */
export async function statusList<Item, Status extends string>(
  api: ApiClient,
  state: ListState,
  how: {
    /** The list's API path ("/orders"); its counts are at `<path>/counts`. */
    path: string;
    /** Every status, in the order it happens. */
    flow: readonly Status[];
    /** The kanban with no filter: one column per status still open. */
    open: readonly Status[];
    /** The statuses the page's filters picked. */
    picked: readonly Status[];
  },
) {
  const kanban = state.view === 'kanban';
  const statuses = how.picked.length > 0 ? how.picked : kanban ? how.open : [];
  const query = pageQuery(state, kanban ? 100 : 50);
  if (statuses.length > 0) query.set('statuses', statuses.join(','));
  const [r, counts] = await Promise.all([
    api.get<Page<Item>>(`${how.path}?${query}`),
    api.get<Partial<Record<Status, number>>>(`${how.path}/counts`),
  ]);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  const count: Partial<Record<Status, number>> = counts.ok ? counts.data : {};
  return {
    page: r.data,
    counts: count,
    // How many the pager can promise: known by status, not for a search.
    total: state.q
      ? undefined
      : (statuses.length > 0 ? statuses : how.flow).reduce(
          (n, s) => n + (count[s] ?? 0),
          0,
        ),
    columns: kanban ? how.flow.filter((s) => statuses.includes(s)) : [],
  };
}
