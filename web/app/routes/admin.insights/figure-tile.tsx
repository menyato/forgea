import { percentChange } from '@forgea/types';
import type { ReactNode } from 'react';

/** Whether a figure going up is good news (sales), bad news (costs) or neither. */
export type Better = 'up' | 'down' | 'neither';

/**
 * One headline figure: the number first, a plain-words line under it, and how it moved since
 * the previous period (an arrow, the percentage, and the same in words for screen readers).
 */
export function FigureTile({
  label,
  value,
  current,
  previous,
  better = 'up',
  note,
  estimated = false,
}: {
  label: string;
  value: ReactNode;
  /** The raw figures compared (amounts or counts). */
  current: string | number;
  previous: string | number;
  better?: Better;
  note?: ReactNode;
  estimated?: boolean;
}) {
  return (
    <div className="grid content-start gap-1 rounded-lg border border-border bg-surface p-4">
      <p className="text-sm text-text-muted">
        {label}
        {estimated && (
          <span className="ml-2 rounded-pill bg-surface-raised px-2 py-0.5 text-xs">
            estimated
          </span>
        )}
      </p>
      <p className="font-display text-2xl font-bold tabular-nums sm:text-3xl">
        {value}
      </p>
      <Change current={current} previous={previous} better={better} />
      {note && <p className="text-xs text-text-muted">{note}</p>}
    </div>
  );
}

function Change({
  current,
  previous,
  better,
}: {
  current: string | number;
  previous: string | number;
  better: Better;
}) {
  const change = percentChange(current, previous);
  if (change === null) {
    return (
      <p className="text-xs text-text-muted">
        {Number(current) === 0
          ? 'Nothing in either period'
          : 'Nothing to compare with before'}
      </p>
    );
  }
  const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'same';
  const tone =
    direction === 'same' || better === 'neither'
      ? 'text-text-muted'
      : direction === better
        ? 'text-success'
        : 'text-danger';
  const words =
    direction === 'same'
      ? 'the same as the previous period'
      : `${direction} ${Math.abs(change)}% on the previous period`;
  return (
    <p className={`text-xs font-medium ${tone}`}>
      <span aria-hidden="true">
        {direction === 'up' ? '↑' : direction === 'down' ? '↓' : '='}{' '}
        {direction === 'same' ? 'same' : `${Math.abs(change)}%`}
      </span>
      <span className="sr-only">{words}</span>
      <span aria-hidden="true" className="text-text-muted">
        {' '}
        vs before
      </span>
    </p>
  );
}
