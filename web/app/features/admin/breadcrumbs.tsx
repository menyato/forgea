import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';

/** A step back up from the current page: a list it was opened from, a section. */
export interface Crumb {
  label: string;
  to: string;
}

/**
 * The address each dashboard page was last seen at in this tab (its tab, filters, search),
 * so a breadcrumb leads back to the list as it was left. Kept in the browser only: filled
 * after the page shows, never on the server.
 */
const lastSeen = new Map<string, string>();

/** Remembers where each dashboard page was last seen (DashboardShell calls it once). */
export function useRememberAddresses() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    lastSeen.set(pathname, search);
  }, [pathname, search]);
}

/** The records each list last showed (their pages' addresses, in order), by the list's path. */
const lastShown = new Map<string, readonly string[]>();

/** A list or kanban remembers what it shows, so a record opened from it can step through them. */
export function useRememberRecords(hrefs: readonly string[]) {
  const { pathname } = useLocation();
  const key = hrefs.join('\n');
  useEffect(() => {
    lastShown.set(pathname, key ? key.split('\n') : []);
  }, [pathname, key]);
}

/**
 * "‹ 3 / 25 ›" on a record opened from a list: the previous and next records of that list as
 * it was last shown. Nothing when the record wasn't opened from it (typed in, a link).
 */
export function RecordPager({ list }: { list: string }) {
  const { pathname } = useLocation();
  const [records, setRecords] = useState<readonly string[]>([]);
  useEffect(() => setRecords(lastShown.get(list) ?? []), [list, pathname]);
  const at = records.indexOf(pathname);
  if (at < 0 || records.length < 2) return null;
  const step = (to: string | undefined, label: string, sign: string) =>
    to ? (
      <Link
        to={to}
        aria-label={label}
        className="rounded-md border border-border px-2.5 py-1 hover:border-accent"
      >
        {sign}
      </Link>
    ) : (
      <span
        aria-hidden
        className="rounded-md border border-border px-2.5 py-1 opacity-40"
      >
        {sign}
      </span>
    );
  return (
    <nav aria-label="Records" className="flex items-center gap-2 text-sm">
      <span className="tabular-nums text-text-muted">
        {at + 1} / {records.length}
      </span>
      {step(records[at - 1], 'Previous record', '‹')}
      {step(records[at + 1], 'Next record', '›')}
    </nav>
  );
}

/** "Dashboard / Orders / FG-123": each step a link back, the last one the page itself. */
export function Breadcrumbs({
  trail,
  current,
}: {
  trail: readonly Crumb[];
  current: string;
}) {
  const steps: Crumb[] = [{ label: 'Dashboard', to: '/admin' }, ...trail];
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-text-muted">
      <ol className="flex flex-wrap items-center gap-x-1.5">
        {steps.map((s) => (
          <li key={s.to} className="flex items-center gap-x-1.5">
            <CrumbLink crumb={s} />
            <span aria-hidden>/</span>
          </li>
        ))}
        <li aria-current="page" className="min-w-0 truncate text-text">
          {current}
        </li>
      </ol>
    </nav>
  );
}

function CrumbLink({ crumb }: { crumb: Crumb }) {
  // The plain address first (server and first paint agree), then the one last seen.
  const [search, setSearch] = useState('');
  useEffect(() => setSearch(lastSeen.get(crumb.to) ?? ''), [crumb.to]);
  return (
    <Link
      to={`${crumb.to}${search}`}
      className="hover:text-text hover:underline"
    >
      {crumb.label}
    </Link>
  );
}
