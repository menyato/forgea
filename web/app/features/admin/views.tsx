import {
  type DragEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import {
  Form,
  Link,
  useFetcher,
  useLocation,
  useSearchParams,
} from 'react-router';
import { useRememberRecords } from './breadcrumbs';
import type { ListState, ViewMode } from './list-state';
import type { SaveResult } from './staff.server';

/** The current address with some search parameters changed (and paging reset). */
function useWith() {
  const [params] = useSearchParams();
  return (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const key of ['cursor', 'at', 'tab']) next.delete(key);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const query = next.toString();
    return query ? `?${query}` : '?';
  };
}

export interface ListFilter {
  key: string;
  label: string;
  /** How many records it holds, when the API counts them. */
  count?: number | undefined;
  /**
   * Filters sharing this name are alternatives the API takes one at a time (open, won,
   * lost): turning one on turns the others off. Others combine.
   */
  only?: string;
  /** Narrows whatever else is on (and), shown as a facet of its own; others add up (or). */
  apart?: boolean;
}

export interface ListOption {
  key: string;
  label: string;
}

/**
 * A list's control panel, as in Odoo: the search box holding the filters, grouping and search
 * that are on (each removable), a menu of filters and groupings, the pager and the view
 * switch. Everything is a link or a GET form over the address, so it works before JavaScript.
 */
export function ControlPanel({
  state,
  search,
  filters = [],
  groups = [],
  views = ['list'],
  page,
}: {
  state: ListState;
  /** What the search box looks through, e.g. "Order number or email". */
  search: string;
  filters?: readonly ListFilter[];
  groups?: readonly ListOption[];
  views?: readonly ViewMode[];
  page?: {
    shown: number;
    total?: number | undefined;
    nextCursor: string | null;
  };
}) {
  const href = useWith();
  const [params] = useSearchParams();
  const inputId = useId();
  // One facet per set of filters that add up: each "apart" one, each set of alternatives,
  // and the rest together ("To confirm or In production").
  const facets: ListFilter[][] = [];
  for (const f of filters.filter((x) => state.filters.includes(x.key))) {
    const set = f.apart ? f.key : (f.only ?? '');
    const facet = facets.find(
      (x) => (x[0]!.apart ? x[0]!.key : (x[0]!.only ?? '')) === set,
    );
    if (facet) facet.push(f);
    else facets.push([f]);
  }
  const grouped = state.groups.flatMap((k) =>
    groups.filter((g) => g.key === k),
  );
  const toggle = (f: ListFilter) => {
    const next = state.filters.includes(f.key)
      ? state.filters.filter((k) => k !== f.key)
      : [
          ...state.filters.filter(
            (k) => !f.only || filters.find((o) => o.key === k)?.only !== f.only,
          ),
          f.key,
        ];
    return href({ filter: next.join(',') });
  };
  // The form keeps everything else on the page as it is, and the filters showing.
  const kept = [...params].filter(
    ([k]) => !['q', 'cursor', 'at', 'tab', 'filter'].includes(k),
  );

  return (
    <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="relative flex min-w-0 rounded-md border border-border bg-surface focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-focus-ring">
        <Form
          method="get"
          role="search"
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 px-2 py-1.5"
        >
          {kept.map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <input type="hidden" name="filter" value={state.filters.join(',')} />
          {facets.map((facet) => (
            <Facet
              key={facet[0]!.key}
              kind="Filter"
              value={facet.map((f) => f.label).join(' or ')}
              remove={href({
                filter: state.filters
                  .filter((k) => !facet.some((f) => f.key === k))
                  .join(','),
              })}
            />
          ))}
          {grouped.length > 0 && (
            <Facet
              kind="Group by"
              value={grouped.map((g) => g.label).join(' › ')}
              remove={href({ group: null })}
            />
          )}
          <label htmlFor={inputId} className="sr-only">
            {search}
          </label>
          <input
            id={inputId}
            name="q"
            type="search"
            key={state.q ?? ''}
            defaultValue={state.q ?? ''}
            placeholder={`Search: ${search.toLowerCase()}…`}
            autoComplete="off"
            className="min-w-32 flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-text-muted"
          />
        </Form>
        {(filters.length > 0 || groups.length > 0) && (
          <FilterMenu
            filters={filters}
            groups={groups}
            state={state}
            toggle={toggle}
            groupHref={(key) => {
              // Adds a level (inside the ones on), or takes it away.
              const next = state.groups.includes(key)
                ? state.groups.filter((k) => k !== key)
                : [...state.groups, key];
              return href({ group: next.length ? next.join(',') : null });
            }}
          />
        )}
      </div>
      <div className="flex items-center justify-between gap-3 lg:justify-end">
        {page && <Pager state={state} {...page} />}
        {views.length > 1 && (
          <div
            role="group"
            aria-label="Show as"
            className="flex rounded-md border border-border text-sm"
          >
            {views.map((mode) => (
              <Link
                key={mode}
                to={href({ view: mode })}
                aria-current={state.view === mode ? 'true' : undefined}
                className={`flex items-center gap-1.5 px-3 py-1.5 first:rounded-l-md last:rounded-r-md ${
                  state.view === mode
                    ? 'bg-accent font-semibold text-on-accent'
                    : 'text-text-muted hover:text-text'
                }`}
              >
                <ViewIcon mode={mode} />
                {mode === 'list' ? 'List' : 'Kanban'}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** One thing narrowing the list, inside the search box: "Filter · To confirm ×". */
function Facet({
  kind,
  value,
  remove,
}: {
  kind: string;
  value: string;
  remove: string;
}) {
  return (
    <span className="inline-flex max-w-full items-center overflow-hidden rounded-md border border-border text-xs">
      <span className="bg-accent px-1.5 py-1 font-semibold text-on-accent">
        {kind}
      </span>
      <span className="min-w-0 truncate px-1.5">{value}</span>
      <Link
        to={remove}
        aria-label={`Remove ${kind.toLowerCase()}: ${value}`}
        className="px-1.5 py-1 text-text-muted hover:text-danger"
      >
        ×
      </Link>
    </span>
  );
}

/** The menu at the end of the search box: filters on the left, groupings on the right. */
function FilterMenu({
  filters,
  groups,
  state,
  toggle,
  groupHref,
}: {
  filters: readonly ListFilter[];
  groups: readonly ListOption[];
  state: ListState;
  toggle: (f: ListFilter) => string;
  groupHref: (key: string) => string;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const { search } = useLocation();
  // Closes once a choice is made, and on a click anywhere else.
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [search]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menu.current && !menu.current.contains(e.target as Node))
        menu.current.open = false;
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  const item = (active: boolean) =>
    `flex items-center justify-between gap-3 rounded px-2 py-1 hover:bg-surface-raised ${
      active ? 'font-semibold text-text' : 'text-text-muted'
    }`;

  return (
    <details ref={menu} className="shrink-0 border-l border-border">
      <summary
        aria-label="Filters and grouping"
        className="flex h-full cursor-pointer list-none items-center px-3 text-text-muted hover:text-text [&::-webkit-details-marker]:hidden"
      >
        <span aria-hidden>▾</span>
      </summary>
      <div className="absolute right-0 top-full z-30 mt-1 grid w-[min(32rem,calc(100vw-2rem))] gap-4 rounded-md border border-border bg-surface p-3 text-sm shadow-lg sm:grid-cols-2">
        {filters.length > 0 && (
          <section aria-label="Filters">
            <h3 className="mb-1 px-2 text-xs font-bold uppercase tracking-wide">
              Filters
            </h3>
            <ul className="grid gap-0.5">
              {filters.map((f, i) => {
                const active = state.filters.includes(f.key);
                const apart = i > 0 && filters[i - 1]!.only !== f.only;
                return (
                  <li
                    key={f.key}
                    className={apart ? 'mt-1 border-t border-border pt-1' : ''}
                  >
                    <Link
                      to={toggle(f)}
                      aria-current={active ? 'true' : undefined}
                      className={item(active)}
                    >
                      <span>
                        <span aria-hidden className="inline-block w-4">
                          {active ? '✓' : ''}
                        </span>
                        {f.label}
                      </span>
                      {f.count !== undefined && (
                        <span className="tabular-nums text-xs">{f.count}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {groups.length > 0 && (
          <section aria-label="Group by">
            <h3 className="mb-1 px-2 text-xs font-bold uppercase tracking-wide">
              Group by
            </h3>
            <ul className="grid gap-0.5">
              {groups.map((g) => {
                const level = state.groups.indexOf(g.key);
                const active = level >= 0;
                return (
                  <li key={g.key}>
                    <Link
                      to={groupHref(g.key)}
                      aria-current={active ? 'true' : undefined}
                      className={item(active)}
                    >
                      <span>
                        <span aria-hidden className="inline-block w-4">
                          {active ? '✓' : ''}
                        </span>
                        {g.label}
                      </span>
                      {active && state.groups.length > 1 && (
                        <span className="text-xs tabular-nums">
                          {level + 1}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </details>
  );
}

/** "51–100 / 230 ‹ ›". Pages follow each other by cursor: back goes to the first page. */
function Pager({
  state,
  shown,
  total,
  nextCursor,
}: {
  state: ListState;
  shown: number;
  total?: number | undefined;
  nextCursor: string | null;
}) {
  const href = useWith();
  const arrow =
    'rounded-md border border-border px-2.5 py-1 hover:border-accent';
  return (
    <nav aria-label="Pages" className="flex items-center gap-2 text-sm">
      <span className="tabular-nums text-text-muted">
        {shown === 0
          ? '0'
          : `${state.at}–${state.at + shown - 1}${total !== undefined ? ` / ${total}` : ''}`}
      </span>
      {state.at > 1 ? (
        <Link to={href({})} aria-label="First page" className={arrow}>
          ‹
        </Link>
      ) : (
        <span aria-hidden className={`${arrow} opacity-40`}>
          ‹
        </span>
      )}
      {nextCursor ? (
        <Link
          to={href({ cursor: nextCursor, at: String(state.at + shown) })}
          aria-label="Next page"
          className={arrow}
        >
          ›
        </Link>
      ) : (
        <span aria-hidden className={`${arrow} opacity-40`}>
          ›
        </span>
      )}
    </nav>
  );
}

function ViewIcon({ mode }: { mode: ViewMode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="currentColor"
    >
      {mode === 'list' ? (
        <path d="M2 3h12v2H2zm0 4h12v2H2zm0 4h12v2H2z" />
      ) : (
        <path d="M1 2h4v12H1zm5 0h4v8H6zm5 0h4v10h-4z" />
      )}
    </svg>
  );
}

export interface ListColumn<T> {
  key: string;
  label: string;
  /** The API sort its header applies (click again to reverse). */
  sort?: string;
  align?: 'right';
  cell: (row: T) => ReactNode;
}

/** How rows are grouped at one level: each row's group, and the groups' natural order. */
export interface Grouping<T> {
  of: (row: T) => string;
  order?: readonly string[];
}

interface GroupNode<T> {
  key: string;
  /** The keys from the outermost group down to this one. */
  path: string;
  rows: T[];
  children: GroupNode<T>[];
}

function groupRows<T>(
  rows: readonly T[],
  levels: readonly Grouping<T>[],
  parent = '',
): GroupNode<T>[] {
  const [level, ...inner] = levels;
  if (!level) return [];
  const nodes: GroupNode<T>[] = [];
  for (const row of rows) {
    const key = level.of(row);
    const node = nodes.find((n) => n.key === key);
    if (node) node.rows.push(row);
    else
      nodes.push({
        key,
        path: parent ? `${parent}\u001f${key}` : key,
        rows: [row],
        children: [],
      });
  }
  const rank = (key: string) => {
    const i = level.order?.indexOf(key) ?? -1;
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  nodes.sort((x, y) => rank(x.key) - rank(y.key));
  for (const n of nodes) n.children = groupRows(n.rows, inner, n.path);
  return nodes;
}

/** The groups opened on a list, per list and grouping, for this browser tab only. */
function useOpenGroups(id: string) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  // Read after the first paint, so server and browser start alike (all closed).
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(id);
      setOpen(new Set(saved ? (JSON.parse(saved) as string[]) : []));
    } catch {
      setOpen(new Set());
    }
  }, [id]);
  const flip = (path: string) =>
    setOpen((now) => {
      const next = new Set(now);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      try {
        sessionStorage.setItem(id, JSON.stringify([...next]));
      } catch {
        // Storage refused: the groups still open, they just aren't remembered.
      }
      return next;
    });
  return [open, flip] as const;
}

/**
 * A list view: one row per record, the whole row opening it; sortable headers. With
 * groupings on, rows sit in groups (inside groups, for several), each closed until opened;
 * the groups opened are remembered when coming back to the list.
 */
export function ListView<T extends { id: string }>({
  label,
  rows,
  columns,
  href,
  state,
  group,
  empty,
}: {
  label: string;
  rows: readonly T[];
  columns: readonly ListColumn<T>[];
  href: (row: T) => string;
  state: ListState;
  /**
   * The grouping for a grouping key (several nest, in the order they were turned on), or one
   * fixed grouping.
   */
  group?: Grouping<T> | ((key: string) => Grouping<T> | undefined) | undefined;
  empty: string;
}) {
  const link = useWith();
  const { pathname } = useLocation();
  useRememberRecords(rows.map(href));
  const levels: Grouping<T>[] =
    typeof group === 'function'
      ? state.groups.flatMap((k) => {
          const g = group(k);
          return g ? [g] : [];
        })
      : group
        ? [group]
        : [];
  const [open, flip] = useOpenGroups(
    `forgea_groups:${pathname}:${state.groups.join(',')}`,
  );
  if (rows.length === 0) return <p className="text-text-muted">{empty}</p>;

  const cellClass = (c: ListColumn<T>) =>
    `px-4 py-2.5 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`;
  const rowsOf = (list: readonly T[]) =>
    list.map((row) => (
      <tr
        key={row.id}
        className="relative border-t border-border hover:bg-surface-raised"
      >
        {columns.map((c, i) => (
          <td key={c.key} className={cellClass(c)}>
            {i === 0 ? (
              // The first cell's link covers the row: the whole row opens it.
              <Link
                to={href(row)}
                className="font-semibold after:absolute after:inset-0 hover:underline"
              >
                {c.cell(row)}
              </Link>
            ) : (
              c.cell(row)
            )}
          </td>
        ))}
      </tr>
    ));
  const nodesOf = (nodes: GroupNode<T>[], depth: number): ReactNode[] =>
    nodes.flatMap((n) => {
      const isOpen = open.has(n.path);
      return [
        <tr
          key={`group:${n.path}`}
          className="border-t border-border bg-surface-raised/60"
        >
          <th
            scope="rowgroup"
            colSpan={columns.length}
            className="px-4 py-2 text-left"
            style={{ paddingLeft: `${1 + depth * 1.5}rem` }}
          >
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => flip(n.path)}
              className="flex items-center gap-2 font-semibold"
            >
              <span
                aria-hidden
                className={`transition-transform ${isOpen ? 'rotate-90' : ''}`}
              >
                ›
              </span>
              {n.key}
              <span className="font-normal text-text-muted">
                ({n.rows.length})
              </span>
            </button>
          </th>
        </tr>,
        ...(isOpen
          ? n.children.length
            ? nodesOf(n.children, depth + 1)
            : rowsOf(n.rows)
          : []),
      ];
    });

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table aria-label={label} className="w-full text-sm">
        <thead className="text-left text-text-muted">
          <tr>
            {columns.map((c) => {
              const active = c.sort !== undefined && state.sort === c.sort;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={
                    active
                      ? state.order === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                  className={`px-4 py-3 font-medium ${c.align === 'right' ? 'text-right' : ''}`}
                >
                  {c.sort ? (
                    <Link
                      to={link({
                        sort: c.sort,
                        order: active && state.order === 'asc' ? 'desc' : 'asc',
                      })}
                      className="inline-flex items-center gap-1 hover:text-text"
                    >
                      {c.label}
                      <span aria-hidden className={active ? '' : 'opacity-30'}>
                        {active && state.order === 'asc' ? '▲' : '▼'}
                      </span>
                    </Link>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {levels.length ? nodesOf(groupRows(rows, levels), 0) : rowsOf(rows)}
        </tbody>
      </table>
    </div>
  );
}

const CARD = 'application/x-forgea-card';

/**
 * A kanban view: a column per stage, a card per record. With `move`, cards drag to another
 * column: the page's action gets `intent=move`, `id` and `to`, makes the same call the
 * record's own buttons do, and the API's refusal (a step not allowed) shows above.
 */
export function KanbanView<T extends { id: string }>({
  columns,
  title,
  card,
  href,
  move = false,
  layout = 'columns',
}: {
  columns: readonly { key: string; title: string; items: readonly T[] }[];
  title: (item: T) => string;
  card: (item: T) => ReactNode;
  href: (item: T) => string;
  move?: boolean;
  /** "grid": one column's cards side by side (a list with no stages). */
  layout?: 'columns' | 'grid';
}) {
  const fetcher = useFetcher<SaveResult>();
  const [over, setOver] = useState<string | null>(null);
  useRememberRecords(columns.flatMap((c) => c.items.map(href)));
  // While a move is on its way, the card already stands in its new column.
  const moving = fetcher.formData
    ? {
        id: String(fetcher.formData.get('id')),
        to: String(fetcher.formData.get('to')),
      }
    : null;
  const all = columns.flatMap((c) => c.items);
  const shown = columns.map((c) => ({
    ...c,
    items: moving
      ? [
          ...c.items.filter((i) => i.id !== moving.id),
          ...(moving.to === c.key ? all.filter((i) => i.id === moving.id) : []),
        ]
      : c.items,
  }));
  const drop = (column: string) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData(CARD);
    const from = columns.find((c) => c.items.some((i) => i.id === id));
    if (!id || !from || from.key === column) return;
    void fetcher.submit({ intent: 'move', id, to: column }, { method: 'post' });
  };

  const cards = (items: readonly T[]) =>
    items.map((item) => (
      <Link
        key={item.id}
        to={href(item)}
        draggable={move}
        onDragStart={
          move ? (e) => e.dataTransfer.setData(CARD, item.id) : undefined
        }
        className={`grid gap-1 rounded-md border border-border bg-surface p-3 text-sm shadow-sm hover:border-accent ${
          moving?.id === item.id ? 'opacity-60' : ''
        } ${move ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
        <span className="font-semibold">{title(item)}</span>
        {card(item)}
      </Link>
    ));

  return (
    <div className="grid gap-3">
      <p aria-live="polite" className="text-sm text-danger empty:hidden">
        {fetcher.state === 'idle' ? (fetcher.data?.error ?? '') : ''}
      </p>
      {layout === 'grid' ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {shown.flatMap((c) => cards(c.items))}
        </div>
      ) : (
        <div className="grid gap-4 overflow-x-auto pb-2 lg:grid-flow-col lg:auto-cols-[minmax(15rem,1fr)]">
          {shown.map((c) => (
            <section
              key={c.key}
              aria-label={c.title}
              onDragOver={
                move
                  ? (e) => {
                      if (!e.dataTransfer.types.includes(CARD)) return;
                      e.preventDefault();
                      setOver(c.key);
                    }
                  : undefined
              }
              onDragLeave={move ? () => setOver(null) : undefined}
              onDrop={move ? drop(c.key) : undefined}
              className={`grid content-start gap-3 rounded-lg p-3 ${
                over === c.key
                  ? 'bg-accent/15 outline-2 outline-dashed outline-accent'
                  : 'bg-surface/60'
              }`}
            >
              <h2 className="flex items-center justify-between font-display text-base font-bold">
                {c.title}
                <span className="text-sm font-normal text-text-muted">
                  {c.items.length}
                </span>
              </h2>
              {c.items.length === 0 ? (
                <p className="text-sm text-text-muted">Nothing here.</p>
              ) : (
                cards(c.items)
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A record's steps along the top of its form, as in Odoo: the one it is in stands out, the
 * ones before it read as done. `aside` holds a step off the main path (Cancelled, Lost).
 */
export function StatusBar({
  steps,
  current,
  aside,
}: {
  steps: readonly { key: string; label: string }[];
  current: string;
  aside?: string | undefined;
}) {
  const at = steps.findIndex((s) => s.key === current);
  return (
    <ol
      aria-label="Status"
      className="mb-4 flex flex-wrap items-center gap-1 text-xs sm:text-sm"
    >
      {steps.map((s, i) => (
        <li
          key={s.key}
          aria-current={i === at && !aside ? 'step' : undefined}
          className={`rounded-pill border px-3 py-1 ${
            i === at && !aside
              ? 'border-accent bg-accent font-semibold text-on-accent'
              : i < at
                ? 'border-border bg-surface-raised text-text'
                : 'border-border text-text-muted'
          }`}
        >
          {i < at && !aside && (
            <span aria-hidden className="mr-1">
              ✓
            </span>
          )}
          {s.label}
        </li>
      ))}
      {aside && (
        <li
          aria-current="step"
          className="rounded-pill border border-danger px-3 py-1 font-semibold text-danger"
        >
          {aside}
        </li>
      )}
    </ol>
  );
}
