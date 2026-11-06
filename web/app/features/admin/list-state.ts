/**
 * A dashboard list's state, all in its address (so it survives a reload, a bookmark and the
 * breadcrumb back): the search text, the filters on, the grouping, the sort, the view and
 * the page. Read the same way by the loader (to ask the API) and the page (to draw it).
 */
export type ViewMode = 'list' | 'kanban';

export interface ListState {
  q: string | null;
  /** The filters on (their keys); none means everything. */
  filters: string[];
  /** The groupings on, outermost first ("group=stage,assigned"). */
  groups: string[];
  /** The outermost grouping (what a kanban's columns follow). */
  group: string | null;
  sort: string;
  order: 'asc' | 'desc';
  view: ViewMode;
  cursor: string | null;
  /** Position of the page's first row, for the pager ("51–100"). */
  at: number;
}

export interface ListDefaults {
  /** On until someone removes them; a search on its own looks through everything. */
  filters?: readonly string[];
  /** The sorts the API accepts for this list; the first is the default. */
  sorts: readonly string[];
  order?: 'asc' | 'desc';
  /** The view it opens in (a pipeline opens as a kanban). */
  view?: ViewMode;
}

export function listState(
  params: URLSearchParams,
  defaults: ListDefaults,
): ListState {
  const q = params.get('q')?.trim() || null;
  const filter = params.get('filter');
  // "?tab=" was these lists' address before filters; it still opens the same one.
  const tab = params.get('tab');
  const filters =
    filter !== null
      ? filter.split(',').filter(Boolean)
      : tab
        ? [tab]
        : q
          ? []
          : [...(defaults.filters ?? [])];
  const sort = params.get('sort');
  const order = params.get('order');
  const at = Number(params.get('at'));
  const view = params.get('view');
  const groups = [
    ...new Set((params.get('group') ?? '').split(',').filter(Boolean)),
  ];
  return {
    q,
    filters,
    groups,
    group: groups[0] ?? null,
    sort: sort && defaults.sorts.includes(sort) ? sort : defaults.sorts[0]!,
    order:
      order === 'asc' || order === 'desc' ? order : (defaults.order ?? 'desc'),
    // "board" was the kanban's earlier name.
    view:
      view === 'list'
        ? 'list'
        : view === 'kanban' || view === 'board'
          ? 'kanban'
          : (defaults.view ?? 'list'),
    cursor: params.get('cursor'),
    at: Number.isInteger(at) && at > 0 ? at : 1,
  };
}

/**
 * A short list the API sends whole (materials, categories, stages…), searched, sorted and
 * paged in the loader, so it behaves like the paged ones. Filter it before. The cursor is the
 * offset of the next page.
 */
export function localList<T>(
  items: readonly T[],
  state: ListState,
  how: {
    /** The text the search looks through. */
    text: (item: T) => string;
    /** Each sort `listState` accepts, by key. */
    sorts: Record<string, (item: T) => string | number>;
  },
  limit = 50,
): { items: T[]; total: number; nextCursor: string | null } {
  const q = state.q?.toLowerCase();
  const found = q
    ? items.filter((i) => how.text(i).toLowerCase().includes(q))
    : [...items];
  const by = how.sorts[state.sort];
  if (by) {
    const sign = state.order === 'asc' ? 1 : -1;
    found.sort((a, b) => {
      const x = by(a);
      const y = by(b);
      return (
        sign *
        (typeof x === 'number' && typeof y === 'number'
          ? x - y
          : String(x).localeCompare(String(y)))
      );
    });
  }
  const from = Math.max(0, Number(state.cursor) || 0);
  return {
    items: found.slice(from, from + limit),
    total: found.length,
    nextCursor: from + limit < found.length ? String(from + limit) : null,
  };
}

/** The API query for a list's page: its sort, direction, cursor and search. */
export function pageQuery(state: ListState, limit: number): URLSearchParams {
  const query = new URLSearchParams({
    limit: String(limit),
    sort: state.sort,
    order: state.order,
  });
  if (state.q) query.set('q', state.q);
  if (state.cursor) query.set('cursor', state.cursor);
  return query;
}
