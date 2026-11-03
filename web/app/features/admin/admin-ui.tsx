import { type ReactNode, useId } from 'react';
import { Busy } from '~/components/brand/busy';
import { Breadcrumbs, type Crumb, RecordPager } from './breadcrumbs';

/**
 * A dashboard page's breadcrumbs, title, one-line explanation and main action. `trail` is
 * the way back up (a detail page's list); null on the dashboard's own first page. A record
 * opened from its list steps to the list's previous and next records.
 */
export function AdminHeader({
  title,
  intro,
  action,
  trail = [],
}: {
  title: string;
  intro: string;
  action?: ReactNode;
  trail?: readonly Crumb[] | null;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="grid min-w-0 gap-1">
        {trail && <Breadcrumbs trail={trail} current={title} />}
        <h1 className="font-display text-3xl font-bold">{title}</h1>
        <p className="max-w-2xl text-text-muted">{intro}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {trail && trail.length > 0 && <RecordPager list={trail.at(-1)!.to} />}
        {action}
      </div>
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
  // Named by its title, so screen readers can jump between panels.
  const id = useId();
  return (
    <section
      aria-labelledby={title ? id : undefined}
      // One shrinkable column: a wide child (a 3D canvas, a long email) can't push past the border.
      className={`grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 ${className}`}
    >
      {title && (
        <h2 id={id} className="font-display text-lg font-bold">
          {title}
        </h2>
      )}
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

/**
 * For someone who may look but not change: every field and button inside is locked, with a
 * line saying why. The API refuses the change anyway; this keeps the page honest.
 */
export function ViewOnly({
  editable,
  children,
}: {
  editable: boolean;
  children: ReactNode;
}) {
  if (editable) return children;
  return (
    <>
      <p className="mb-4 text-sm text-text-muted">
        You can see this page but not change it. Ask an admin if you need to.
      </p>
      <fieldset disabled className="contents">
        {children}
      </fieldset>
    </>
  );
}
