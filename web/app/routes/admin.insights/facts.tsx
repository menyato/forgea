import type { ReactNode } from 'react';
import { Link } from 'react-router';

export function Fact({
  label,
  to,
  children,
}: {
  label: string;
  to?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-text-muted">
        {to ? (
          <Link to={to} className="hover:text-text hover:underline">
            {label}
          </Link>
        ) : (
          label
        )}
      </dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

/** Horizontal bars with their values written out: no chart needed to read them. */
export function Bars({
  rows,
  empty = 'Nothing yet.',
}: {
  rows: {
    key: string;
    label: string;
    value: number;
    text: ReactNode;
    /** Where the row's records are. */
    to?: string | undefined;
  }[];
  empty?: string;
}) {
  if (rows.length === 0)
    return <p className="text-sm text-text-muted">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="grid gap-2 text-sm">
      {rows.map((r) => (
        <li key={r.key} className="grid gap-1">
          <div className="flex justify-between gap-4">
            {r.to ? (
              <Link to={r.to} className="min-w-0 truncate hover:underline">
                {r.label}
              </Link>
            ) : (
              <span className="min-w-0 truncate">{r.label}</span>
            )}
            <span className="tabular-nums">{r.text}</span>
          </div>
          <div
            className="h-2 rounded-pill bg-surface-raised"
            aria-hidden="true"
          >
            <div
              className="h-2 rounded-pill bg-accent"
              style={{ width: `${Math.max((r.value / max) * 100, 0)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Two parts of a whole, e.g. new and returning customers. */
export function Split({
  label,
  a,
  b,
}: {
  label: string;
  a: { label: string; value: number };
  b: { label: string; value: number };
}) {
  const total = a.value + b.value;
  const share = total ? Math.round((a.value / total) * 100) : 0;
  return (
    <div className="grid gap-1 text-sm">
      <div className="flex flex-wrap justify-between gap-x-4">
        <span className="font-medium">{label}</span>
        <span className="text-text-muted">
          {a.label} {a.value}
          {total ? ` (${share}%)` : ''} · {b.label} {b.value}
          {total ? ` (${100 - share}%)` : ''}
        </span>
      </div>
      <div
        className="flex h-2 overflow-hidden rounded-pill bg-surface-raised"
        aria-hidden="true"
      >
        <div className="h-2 bg-accent" style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}

/** Steps of a funnel, each with its share of the first. */
export function Funnel({
  steps,
}: {
  steps: { label: string; value: number; to?: string }[];
}) {
  const first = steps[0]?.value ?? 0;
  return (
    <ol className="grid gap-1 text-sm">
      {steps.map((s, n) => (
        <li key={s.label} className="flex justify-between gap-4">
          {s.to ? (
            <Link to={s.to} className="hover:underline">
              {s.label}
            </Link>
          ) : (
            <span>{s.label}</span>
          )}
          <span className="tabular-nums">
            {s.value}
            {n > 0 && first > 0 && (
              <span className="text-text-muted">
                {' '}
                ({Math.round((s.value / first) * 100)}%)
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
