import type { ReactNode } from 'react';
import { Busy } from '~/components/brand/busy';

/** A dashboard page's title, one-line explanation and main action. */
export function AdminHeader({
  title,
  intro,
  action,
}: {
  title: string;
  intro: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="grid gap-1">
        <h1 className="font-display text-3xl font-bold">{title}</h1>
        <p className="max-w-2xl text-text-muted">{intro}</p>
      </div>
      {action}
    </header>
  );
}

/** A bordered block grouping related fields. */
export function Panel({
  title,
  children,
  className = '',
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`grid gap-4 rounded-lg border border-border bg-surface p-5 ${className}`}
    >
      {title && <h2 className="font-display text-lg font-bold">{title}</h2>}
      {children}
    </section>
  );
}

/** "Saved" confirmation or the API's error, announced to screen readers. */
export function SaveStatus({
  state,
  result,
}: {
  state: 'idle' | 'loading' | 'submitting';
  result: { ok?: boolean; error?: string } | undefined;
}) {
  return (
    <p aria-live="polite" className="text-sm">
      {state !== 'idle' ? (
        <Busy label="Saving…" className="text-text-muted" />
      ) : result?.error ? (
        <span className="text-danger">{result.error}</span>
      ) : result?.ok ? (
        <span className="text-success">Saved</span>
      ) : null}
    </p>
  );
}
