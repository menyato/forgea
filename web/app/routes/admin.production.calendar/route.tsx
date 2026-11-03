import {
  type Page,
  PRINT_JOB_STATUS_LABELS,
  type PrintJobListItem,
} from '@forgea/types';
import { Link } from 'react-router';
import { AdminHeader, Panel } from '~/features/admin/admin-ui';
import { apiContext } from '~/lib/request.server';
import { fromStudioInput, studioDay, studioFormat } from '~/lib/studio-time';
import type { Route } from './+types/route';

const DAY_MS = 86_400_000;

/** A calendar day ("2026-11-02") `days` later. */
const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);

/** The Monday of the week holding `day`, a studio calendar day (the studio plans in whole weeks). */
const weekStart = (day: string) =>
  addDays(day, -((new Date(`${day}T00:00Z`).getUTCDay() + 6) % 7));

export async function loader({ url, context }: Route.LoaderArgs) {
  const asked = url.searchParams.get('week') ?? '';
  const week = weekStart(
    /^\d{4}-\d{2}-\d{2}$/.test(asked) && !Number.isNaN(Date.parse(asked))
      ? asked
      : studioDay(new Date().toISOString()),
  );
  // From the studio's Monday midnight to the next one.
  const query = new URLSearchParams({
    limit: '100',
    scheduledFrom: fromStudioInput(week),
    scheduledTo: fromStudioInput(addDays(week, 7)),
  });
  const r = await context
    .get(apiContext)
    .get<Page<PrintJobListItem>>(`/print-jobs?${query}`);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { week, jobs: r.data.items };
}

/** A calendar day's name (days are plain dates, so read as UTC). */
const label = (day: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${day}T12:00Z`).toLocaleDateString('en-GB', {
    ...options,
    timeZone: 'UTC',
  });
const TIME = studioFormat({ hour: '2-digit', minute: '2-digit' });

/** The production calendar: a week of scheduled runs, day by day, each opening its job. */
export default function ProductionCalendar({
  loaderData,
}: Route.ComponentProps) {
  const { week, jobs } = loaderData;
  const shift = (days: number) => `?week=${addDays(week, days)}`;
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  return (
    <>
      <AdminHeader
        trail={[{ label: 'Production', to: '/admin/production' }]}
        title="Week calendar"
        intro="Scheduled print runs, day by day (Beirut time). They also appear on the studio's Google Calendar."
      />
      <Panel
        title={`Week of ${label(week, { day: 'numeric', month: 'long', year: 'numeric' })}`}
      >
        <nav aria-label="Weeks" className="flex items-center gap-3 text-sm">
          <Link to={shift(-7)} className="underline">
            Previous week
          </Link>
          <Link to="?" className="underline">
            This week
          </Link>
          <Link to={shift(7)} className="underline">
            Next week
          </Link>
        </nav>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
          {days.map((d) => {
            const today = jobs
              .filter(
                (j) => j.scheduledDate && studioDay(j.scheduledDate) === d,
              )
              .sort((a, b) =>
                (a.scheduledDate ?? '').localeCompare(b.scheduledDate ?? ''),
              );
            return (
              <section
                key={d}
                aria-label={label(d, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
                className="grid min-w-0 content-start gap-2 rounded-md bg-background p-2"
              >
                <h2 className="text-xs font-semibold text-text-muted">
                  {label(d, { weekday: 'short', day: 'numeric' })}
                </h2>
                {today.map((j) => (
                  <Link
                    key={j.id}
                    to={`/admin/production/${j.id}`}
                    className="grid rounded bg-surface p-1.5 text-xs hover:outline hover:outline-1 hover:outline-accent"
                  >
                    <span className="font-mono font-semibold">
                      {j.orderNumber}
                    </span>
                    <span className="text-text-muted">
                      {TIME.format(new Date(j.scheduledDate!))} · {j.machine}
                    </span>
                    <span className="text-text-muted">
                      {PRINT_JOB_STATUS_LABELS[j.status]}
                    </span>
                  </Link>
                ))}
              </section>
            );
          })}
        </div>
      </Panel>
    </>
  );
}
