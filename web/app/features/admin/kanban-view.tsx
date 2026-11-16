import { type DragEvent, type ReactNode, useState } from 'react';
import { Link, useFetcher } from 'react-router';
import { useRememberRecords } from './breadcrumbs';
import type { SaveResult } from './staff.server';

const CARD = 'application/x-forgea-card';

/**
 * A kanban view: a column per stage, a card per record. With `move`, cards drag to another
 * column: the page's action gets `intent=move`, `id`, `from` and `to`, makes the same call the
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
    // Where it was seen: the page's action can refuse a move from a stale board.
    void fetcher.submit(
      { intent: 'move', id, from: from.key, to: column },
      { method: 'post' },
    );
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
