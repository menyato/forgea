import {
  type MaterialView,
  type OrderListItem,
  type Page,
  PRINT_JOB_FLOW,
  PRINT_JOB_STATUS_LABELS,
  type PrintJobListItem,
  PrintJobStatus,
} from '@forgea/types';
import { CreatePrintJobDto, UpdatePrintJobDto } from '@forgea/validation';
import { Link, useFetcher, useSearchParams } from 'react-router';
import { Button } from '~/components/ui/button';
import { Field, SelectField } from '~/components/ui/field';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

const DAY_MS = 86_400_000;

/** Monday 00:00 UTC of the week holding `date` (the studio plans in whole weeks). */
function weekStart(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS);
}

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const week = weekStart(new Date(url.searchParams.get('week') ?? Date.now()));
  const end = new Date(week.getTime() + 7 * DAY_MS);
  const [open, scheduled, orders, materials] = await Promise.all([
    api.get<Page<PrintJobListItem>>('/print-jobs?limit=100'),
    api.get<Page<PrintJobListItem>>(
      `/print-jobs?limit=100&scheduledFrom=${week.toISOString()}&scheduledTo=${end.toISOString()}`,
    ),
    // Only orders being produced, however old: jobs are made for those.
    api.get<Page<OrderListItem>>(
      '/orders?limit=100&statuses=CONFIRMED,IN_PRODUCTION',
    ),
    api.get<MaterialView[]>('/materials'),
  ]);
  for (const r of [open, scheduled, orders]) {
    if (!r.ok) throw new Response(r.message, { status: r.status });
  }
  return {
    week: week.toISOString(),
    jobs: open.ok ? open.data.items : [],
    thisWeek: scheduled.ok ? scheduled.data.items : [],
    orders: orders.ok ? orders.data.items : [],
    materials: materials.ok ? materials.data.filter((m) => m.active) : [],
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const id = text(form, 'id');
  if (id) {
    const when = text(form, 'scheduledDate');
    return save(
      UpdatePrintJobDto,
      {
        status: text(form, 'status'),
        ...(form.has('scheduledDate')
          ? { scheduledDate: when ? new Date(when).toISOString() : null }
          : {}),
      },
      (dto) => api.patch(`/print-jobs/${encodeURIComponent(id)}`, dto),
    );
  }
  const when = text(form, 'scheduledDate');
  return save(
    CreatePrintJobDto,
    {
      orderId: text(form, 'orderId'),
      materialId: text(form, 'materialId'),
      color: text(form, 'color'),
      grams: text(form, 'grams'),
      hours: text(form, 'hours'),
      machine: text(form, 'machine'),
      ...(when ? { scheduledDate: new Date(when).toISOString() } : {}),
    },
    (dto) => api.post('/print-jobs', dto),
  );
}

const BOARD = [
  PrintJobStatus.QUEUED,
  PrintJobStatus.SCHEDULED,
  PrintJobStatus.PRINTING,
  PrintJobStatus.FAILED,
  PrintJobStatus.DONE,
] as const;

export default function Production({ loaderData }: Route.ComponentProps) {
  const { week, jobs, thisWeek, orders, materials } = loaderData;
  const [params] = useSearchParams();
  const start = new Date(week);
  const shift = (days: number) =>
    `?${new URLSearchParams({ ...Object.fromEntries(params), week: new Date(start.getTime() + days * DAY_MS).toISOString().slice(0, 10) })}`;
  const days = Array.from(
    { length: 7 },
    (_, i) => new Date(start.getTime() + i * DAY_MS),
  );

  return (
    <>
      <AdminHeader
        title="Production"
        intro="Print runs for each order: plan them on a printer and a day, move them along as they print. Scheduled runs also appear on the studio's Google Calendar; a finished or failed print takes its filament out of stock."
      />
      <div className="grid gap-6">
        <Panel title="This week">
          <div className="flex items-center gap-3 text-sm">
            <Link to={shift(-7)} className="underline">
              Previous week
            </Link>
            <span className="font-semibold">
              {start.toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                timeZone: 'UTC',
              })}
            </span>
            <Link to={shift(7)} className="underline">
              Next week
            </Link>
          </div>
          <div className="grid gap-2 sm:grid-cols-7">
            {days.map((d) => (
              <div
                key={d.toISOString()}
                className="grid content-start gap-2 rounded-md bg-background p-2"
              >
                <p className="text-xs font-semibold text-text-muted">
                  {d.toLocaleDateString('en-GB', {
                    weekday: 'short',
                    day: 'numeric',
                    timeZone: 'UTC',
                  })}
                </p>
                {thisWeek
                  .filter(
                    (j) =>
                      j.scheduledDate?.slice(0, 10) ===
                      d.toISOString().slice(0, 10),
                  )
                  .map((j) => (
                    <p key={j.id} className="rounded bg-surface p-1.5 text-xs">
                      <span className="font-mono font-semibold">
                        {j.orderNumber}
                      </span>
                      <span className="block text-text-muted">
                        {new Date(j.scheduledDate!).toLocaleTimeString(
                          'en-GB',
                          { hour: '2-digit', minute: '2-digit' },
                        )}{' '}
                        · {j.machine}
                      </span>
                    </p>
                  ))}
              </div>
            ))}
          </div>
        </Panel>

        <div className="grid gap-4 lg:grid-cols-5">
          {BOARD.map((status) => (
            <section
              key={status}
              aria-label={PRINT_JOB_STATUS_LABELS[status]}
              className="grid content-start gap-3"
            >
              <h2 className="font-display text-lg font-bold">
                {PRINT_JOB_STATUS_LABELS[status]}
              </h2>
              {jobs
                .filter((j) => j.status === status)
                .map((j) => (
                  <JobCard key={j.id} job={j} />
                ))}
            </section>
          ))}
        </div>

        <NewJob orders={orders} materials={materials} />
      </div>
    </>
  );
}

function JobCard({ job }: { job: PrintJobListItem }) {
  const fetcher = useFetcher<SaveResult>();
  const next = PRINT_JOB_FLOW[job.status];
  const canSchedule =
    job.status === PrintJobStatus.QUEUED ||
    job.status === PrintJobStatus.SCHEDULED;
  return (
    <article className="grid gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
      <p>
        <span className="font-mono font-semibold">{job.orderNumber}</span>
        <span className="block text-text-muted">
          {job.grams} g {job.material} · {job.color} · {job.hours} h ·{' '}
          {job.machine}
        </span>
      </p>
      {canSchedule && (
        <fetcher.Form method="post" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={job.id} />
          <label className="grid gap-1 text-xs">
            <span>When</span>
            <input
              type="datetime-local"
              name="scheduledDate"
              defaultValue={
                job.scheduledDate ? toLocalInput(job.scheduledDate) : ''
              }
              className="rounded border border-border bg-background px-1.5 py-1"
            />
          </label>
          <Button
            type="submit"
            variant="secondary"
            className="px-2 py-1 text-xs"
          >
            {job.scheduledDate ? 'Move' : 'Schedule'}
          </Button>
        </fetcher.Form>
      )}
      {next.length > 0 && (
        <fetcher.Form method="post" className="flex flex-wrap gap-1">
          <input type="hidden" name="id" value={job.id} />
          {next
            .filter((s) => s !== PrintJobStatus.SCHEDULED)
            .map((s) => (
              <Button
                key={s}
                type="submit"
                name="status"
                value={s}
                variant="secondary"
                className="px-2 py-1 text-xs"
              >
                {PRINT_JOB_STATUS_LABELS[s]}
              </Button>
            ))}
        </fetcher.Form>
      )}
      <SaveStatus state={fetcher.state} result={fetcher.data} />
    </article>
  );
}

/** "2026-11-02T08:00:00.000Z" → the value a datetime-local input shows, in the viewer's time. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function NewJob({
  orders,
  materials,
}: {
  orders: OrderListItem[];
  materials: MaterialView[];
}) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <Panel title="Add a print run">
      {orders.length === 0 ? (
        <p className="text-sm text-text-muted">
          Print runs are added for confirmed orders. None is waiting right now.
        </p>
      ) : (
        <fetcher.Form
          method="post"
          key={fetcher.data?.ok ? 'reset' : 'form'}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <SelectField label="Order" name="orderId" error={errors['orderId']}>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.orderNumber} · {o.customerEmail}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Material"
            name="materialId"
            error={errors['materialId']}
          >
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.stockGrams} g in stock)
              </option>
            ))}
          </SelectField>
          <Field label="Colour" name="color" required error={errors['color']} />
          <Field
            label="Printer"
            name="machine"
            required
            defaultValue="Printer 1"
            error={errors['machine']}
          />
          <Field
            label="Grams"
            name="grams"
            inputMode="decimal"
            required
            error={errors['grams']}
          />
          <Field
            label="Hours"
            name="hours"
            inputMode="decimal"
            required
            error={errors['hours']}
          />
          <Field
            label="When (optional)"
            name="scheduledDate"
            type="datetime-local"
            error={errors['scheduledDate']}
          />
          <div className="flex items-end gap-3">
            <Button type="submit" disabled={fetcher.state !== 'idle'}>
              Add
            </Button>
            <SaveStatus state={fetcher.state} result={fetcher.data} />
          </div>
        </fetcher.Form>
      )}
    </Panel>
  );
}
