import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

/** The current address with one search parameter changed (and paging reset). */
function useWith() {
  const [params] = useSearchParams();
  return (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    next.delete('cursor');
    if (value === null) next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    return query ? `?${query}` : '?';
  };
}

export interface ViewTab {
  key: string;
  label: string;
  /** Shown beside the label, e.g. how many orders wait for a deposit. */
  count?: number | undefined;
}

/**
 * Tabs that split a list by what needs doing ("To confirm", "In production", "New"…): plain
 * links (`?tab=…`), so they work before JavaScript and can be bookmarked.
 */
export function ViewTabs({
  label,
  tabs,
  current,
  param = 'tab',
}: {
  label: string;
  tabs: readonly ViewTab[];
  current: string;
  param?: string;
}) {
  const href = useWith();
  return (
    <nav
      aria-label={label}
      className="mb-4 flex gap-1 overflow-x-auto border-b border-border"
    >
      {tabs.map((t) => {
        const active = t.key === current;
        return (
          <Link
            key={t.key}
            to={href(param, t.key)}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm ${
              active
                ? 'border-accent font-semibold text-text'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span
                className={`rounded-pill px-2 text-xs ${
                  active
                    ? 'bg-accent text-on-accent'
                    : 'bg-surface-raised text-text-muted'
                }`}
              >
                {t.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export type ViewMode = 'list' | 'board';

export const viewMode = (params: URLSearchParams): ViewMode =>
  params.get('view') === 'board' ? 'board' : 'list';

/** "List | Board": the same items as a table or as columns of cards. */
export function ViewSwitch({ current }: { current: ViewMode }) {
  const href = useWith();
  return (
    <div
      role="group"
      aria-label="Show as"
      className="flex rounded-md border border-border text-sm"
    >
      {(['list', 'board'] as const).map((mode) => (
        <Link
          key={mode}
          to={href('view', mode === 'list' ? null : mode)}
          aria-current={current === mode ? 'true' : undefined}
          className={`px-3 py-1.5 first:rounded-l-md last:rounded-r-md ${
            current === mode
              ? 'bg-accent font-semibold text-on-accent'
              : 'text-text-muted hover:text-text'
          }`}
        >
          {mode === 'list' ? 'List' : 'Board'}
        </Link>
      ))}
    </div>
  );
}

/** Kanban columns: one per step, each with its cards and how many. */
export function Board<T extends { id: string }>({
  columns,
  card,
}: {
  columns: readonly { key: string; title: string; items: readonly T[] }[];
  card: (item: T) => ReactNode;
}) {
  return (
    <div className="grid gap-4 overflow-x-auto pb-2 lg:grid-flow-col lg:auto-cols-[minmax(15rem,1fr)]">
      {columns.map((c) => (
        <section
          key={c.key}
          aria-label={c.title}
          className="grid content-start gap-3 rounded-lg bg-surface/60 p-3"
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
            c.items.map((item) => <div key={item.id}>{card(item)}</div>)
          )}
        </section>
      ))}
    </div>
  );
}

/** A small card for a board column: a title link and a few lines under it. */
export function BoardCard({
  to,
  title,
  children,
}: {
  to: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="grid gap-1 rounded-md border border-border bg-surface p-3 text-sm shadow-sm hover:border-accent"
    >
      <span className="font-semibold">{title}</span>
      {children}
    </Link>
  );
}
