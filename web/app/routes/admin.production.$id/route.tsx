import {
  PRINT_JOB_FLOW,
  PRINT_JOB_STATUS_LABELS,
  type PrintJobListItem,
  PrintJobStatus,
} from '@forgea/types';
import { UpdatePrintJobDto } from '@forgea/validation';
import { Link, useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { useCan } from '~/features/admin/access';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { StatusBar } from '~/features/admin/views';
import {
  PRINT_JOB_ASIDE,
  PRINT_JOB_STEPS,
} from '~/features/production/print-job-steps';
import { apiContext } from '~/lib/request.server';
import { fromStudioInput, studioFormat, studioInput } from '~/lib/studio-time';
import type { Route } from './+types/route';

export async function loader({ url, params, context }: Route.LoaderArgs) {
  const r = await context
    .get(apiContext)
    .get<PrintJobListItem>(`/print-jobs/${encodeURIComponent(params.id)}`);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  // Dropped on Scheduled in the kanban: straight to picking when it prints.
  return { job: r.data, plan: url.searchParams.has('plan') };
}

/** status | schedule | machine: each one PATCH of the job; the API refuses a step not allowed. */
export async function action({ request, params, context }: Route.ActionArgs) {
  const form = await request.formData();
  const send = (dto: UpdatePrintJobDto) =>
    context
      .get(apiContext)
      .patch(`/print-jobs/${encodeURIComponent(params.id)}`, dto);
  switch (form.get('intent')) {
    case 'schedule': {
      const when = text(form, 'scheduledDate');
      return save(
        UpdatePrintJobDto,
        { scheduledDate: when ? fromStudioInput(when) : null },
        send,
      );
    }
    case 'machine':
      return save(UpdatePrintJobDto, { machine: text(form, 'machine') }, send);
    default:
      return save(UpdatePrintJobDto, { status: text(form, 'status') }, send);
  }
}

const FULL = studioFormat({ dateStyle: 'full', timeStyle: 'short' });
const when = (iso: string) => FULL.format(new Date(iso));

export default function PrintJobPage({ loaderData }: Route.ComponentProps) {
  const { job, plan } = loaderData;
  const step = useFetcher<SaveResult>();
  const schedule = useFetcher<SaveResult>();
  const printer = useFetcher<SaveResult>();
  const mayWork = useCan()('production.manage');
  // Scheduling is done with a date below, not as a plain step.
  const next = PRINT_JOB_FLOW[job.status].filter(
    (s) => s !== PrintJobStatus.SCHEDULED,
  );
  const plannable =
    job.status === PrintJobStatus.QUEUED ||
    job.status === PrintJobStatus.SCHEDULED;
  return (
    <>
      <AdminHeader
        trail={[{ label: 'Production', to: '/admin/production' }]}
        title={`Print run · ${job.orderNumber}`}
        intro={`${job.grams} g of ${job.material}, ${job.color}, about ${job.hours} h on ${job.machine}.`}
      />
      <StatusBar
        steps={PRINT_JOB_STEPS.map((s) => ({
          key: s,
          label: PRINT_JOB_STATUS_LABELS[s],
        }))}
        current={job.status}
        aside={
          PRINT_JOB_ASIDE.includes(job.status)
            ? PRINT_JOB_STATUS_LABELS[job.status]
            : undefined
        }
      />
      {mayWork && next.length > 0 && (
        <step.Form method="post" className="mb-6 flex flex-wrap gap-2">
          <input type="hidden" name="intent" value="status" />
          {next.map((s, i) => (
            <Button
              key={s}
              type="submit"
              name="status"
              value={s}
              variant={i === 0 ? 'primary' : 'secondary'}
              disabled={step.state !== 'idle'}
            >
              {PRINT_JOB_STATUS_LABELS[s]}
            </Button>
          ))}
          <SaveStatus state={step.state} result={step.data} />
        </step.Form>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="The print">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
            <dt className="text-text-muted">Order</dt>
            <dd>
              <Link
                to={`/admin/orders/${job.orderId}`}
                className="font-mono underline"
              >
                {job.orderNumber}
              </Link>
            </dd>
            <dt className="text-text-muted">Material</dt>
            <dd>
              {job.material} · {job.color}
            </dd>
            <dt className="text-text-muted">Filament</dt>
            <dd>{job.grams} g</dd>
            <dt className="text-text-muted">Printing time</dt>
            <dd>{job.hours} h</dd>
            <dt className="text-text-muted">Printer</dt>
            <dd>{job.machine}</dd>
            <dt className="text-text-muted">Scheduled</dt>
            <dd>{job.scheduledDate ? when(job.scheduledDate) : 'Not yet'}</dd>
            <dt className="text-text-muted">Added</dt>
            <dd>{when(job.createdAt)}</dd>
          </dl>
        </Panel>
        {mayWork && plannable && (
          <Panel title="Plan it">
            <schedule.Form
              method="post"
              className="flex flex-wrap items-end gap-3"
            >
              <input type="hidden" name="intent" value="schedule" />
              <Field
                label="When it prints (Beirut time)"
                name="scheduledDate"
                type="datetime-local"
                key={job.scheduledDate ?? 'none'}
                autoFocus={plan}
                defaultValue={
                  job.scheduledDate ? studioInput(job.scheduledDate) : ''
                }
                hint="Empty takes it off the calendar and back to waiting."
              />
              <Button
                type="submit"
                variant="secondary"
                disabled={schedule.state !== 'idle'}
              >
                {job.scheduledDate ? 'Move' : 'Schedule'}
              </Button>
              <SaveStatus state={schedule.state} result={schedule.data} />
            </schedule.Form>
            <printer.Form
              method="post"
              className="flex flex-wrap items-end gap-3"
            >
              <input type="hidden" name="intent" value="machine" />
              <Field
                label="Printer"
                name="machine"
                required
                key={job.machine}
                defaultValue={job.machine}
                error={printer.data?.errors?.['machine']}
              />
              <Button
                type="submit"
                variant="secondary"
                disabled={printer.state !== 'idle'}
              >
                Change printer
              </Button>
              <SaveStatus state={printer.state} result={printer.data} />
            </printer.Form>
          </Panel>
        )}
      </div>
    </>
  );
}
