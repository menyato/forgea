import type { ReactNode } from 'react';
import { Link } from 'react-router';

/** One figure about a record, and where its details are. */
export interface SmartButton {
  label: string;
  value: ReactNode;
  /** A second, quieter line ("2 colours", "estimated"). */
  hint?: string | undefined;
  /** Where the figure comes from: a list filtered to this record, or a part of this page. */
  to?: string | undefined;
}

/**
 * The figures that join a record to the rest of the back office, in a row at its top (as
 * Odoo's smart buttons do): each says one thing in a glance and opens where it comes from.
 */
export function SmartButtons({
  label,
  buttons,
}: {
  /** What the row is about, for screen readers ("This order in figures"). */
  label: string;
  buttons: readonly SmartButton[];
}) {
  if (buttons.length === 0) return null;
  return (
    <ul
      aria-label={label}
      className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
    >
      {buttons.map((b) => {
        const body = (
          <>
            <span className="block text-xs font-medium uppercase tracking-wide text-text-muted">
              {b.label}
            </span>
            <span className="block truncate text-lg font-semibold tabular-nums">
              {b.value}
            </span>
            {b.hint && (
              <span className="block truncate text-xs text-text-muted">
                {b.hint}
              </span>
            )}
          </>
        );
        const box =
          'block h-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2';
        return (
          <li key={b.label} className="min-w-0">
            {b.to ? (
              <Link
                to={b.to}
                className={`${box} hover:border-accent focus-visible:outline-2 focus-visible:outline-focus-ring`}
              >
                {body}
              </Link>
            ) : (
              <div className={box}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
