import { type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useRememberRecords } from './breadcrumbs';
import {
  type DeletableKind,
  DeleteDialog,
  useCanDelete,
} from './delete-record';
import { useWith } from './control-panel';
import type { ListState } from './list-state';

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
 * the groups opened are remembered when coming back to the list. With `remove`, someone who
 * may delete that kind ticks rows and deletes them, after a dialog says what each affects.
 */
export function ListView<T extends { id: string }>({
  label,
  rows,
  columns,
  href,
  state,
  group,
  empty,
  remove,
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
  /** The kind of record the rows are, to tick and delete them. */
  remove?: DeletableKind | undefined;
}) {
  const link = useWith();
  const selectable = useCanDelete(remove);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [asking, setAsking] = useState(false);
  const ids = rows.map((r) => r.id).join(',');
  // A new page of rows starts with nothing ticked.
  useEffect(() => setPicked(new Set()), [ids]);
  const pick = (id: string, on: boolean) =>
    setPicked((now) => {
      const next = new Set(now);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
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
  const span = columns.length + (selectable ? 1 : 0);
  const rowsOf = (list: readonly T[]) =>
    list.map((row) => (
      <tr
        key={row.id}
        className="relative border-t border-border hover:bg-surface-raised"
      >
        {selectable && (
          <td className="relative z-10 w-10 py-2.5 pl-4">
            <input
              type="checkbox"
              name="selected"
              value={row.id}
              autoComplete="off"
              aria-label="Select"
              checked={picked.has(row.id)}
              onChange={(e) => pick(row.id, e.target.checked)}
            />
          </td>
        )}
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
            colSpan={span}
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

  const all = rows.length > 0 && rows.every((r) => picked.has(r.id));
  return (
    <div className="grid gap-2">
      {picked.size > 0 && (
        <div
          role="toolbar"
          aria-label="Selected records"
          className="flex flex-wrap items-center gap-3 rounded-md border border-accent bg-surface px-3 py-2 text-sm"
        >
          <span className="font-semibold">{picked.size} selected</span>
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="rounded-md border border-danger px-3 py-1 font-semibold text-danger hover:bg-surface-raised"
          >
            Delete…
          </button>
          <button
            type="button"
            onClick={() => setPicked(new Set())}
            className="text-text-muted hover:text-text"
          >
            Clear
          </button>
        </div>
      )}
      {asking && remove && (
        <DeleteDialog
          kind={remove}
          ids={[...picked]}
          onClose={() => setAsking(false)}
          onDeleted={() => setPicked(new Set())}
        />
      )}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table aria-label={label} className="w-full text-sm">
          <thead className="text-left text-text-muted">
            <tr>
              {selectable && (
                <th scope="col" className="w-10 py-3 pl-4">
                  <input
                    type="checkbox"
                    name="select-all"
                    autoComplete="off"
                    aria-label="Select all on this page"
                    checked={all}
                    onChange={(e) =>
                      setPicked(
                        new Set(e.target.checked ? rows.map((r) => r.id) : []),
                      )
                    }
                  />
                </th>
              )}
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
                          order:
                            active && state.order === 'asc' ? 'desc' : 'asc',
                        })}
                        className="inline-flex items-center gap-1 hover:text-text"
                      >
                        {c.label}
                        <span
                          aria-hidden
                          className={active ? '' : 'opacity-30'}
                        >
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
    </div>
  );
}
