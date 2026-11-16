import { useEffect, useId, useRef, type RefObject } from 'react';
import { Form, Link, useLocation, useSearchParams } from 'react-router';
import type { ListState, ViewMode } from './list-state';

/** The current address with some search parameters changed (and paging reset). */
export function useWith() {
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
  const menu = useRef<HTMLDetailsElement>(null);
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
      {/* A click anywhere on the field (not only its arrow) opens the menu; above the page's
          cards and rows, so the menu always shows over them. */}
      <div
        className="relative z-20 flex min-w-0 cursor-text rounded-md border border-border bg-surface focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-focus-ring"
        onClick={(e) => {
          const target = e.target as HTMLElement;
          // Links (a facet's ×, a menu choice) and the arrow do their own thing.
          if (target.closest('a, summary, [role="group"]')) return;
          if (menu.current) menu.current.open = true;
          document.getElementById(inputId)?.focus();
        }}
      >
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
            menu={menu}
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
  menu,
  filters,
  groups,
  state,
  toggle,
  groupHref,
}: {
  menu: RefObject<HTMLDetailsElement | null>;
  filters: readonly ListFilter[];
  groups: readonly ListOption[];
  state: ListState;
  toggle: (f: ListFilter) => string;
  groupHref: (key: string) => string;
}) {
  const { search } = useLocation();
  // Closes once a choice is made, and on a click anywhere else.
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [menu, search]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      // The whole search field counts as the menu's own: a click on it opens it.
      const field = menu.current?.parentElement ?? menu.current;
      if (menu.current && field && !field.contains(e.target as Node))
        menu.current.open = false;
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menu]);
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
      <div
        role="group"
        aria-label="Filter and group choices"
        className="absolute right-0 top-full z-30 mt-1 grid w-[min(32rem,calc(100vw-2rem))] gap-4 rounded-md border border-border bg-surface p-3 text-sm shadow-lg sm:grid-cols-2"
      >
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
