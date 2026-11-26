import {
  PRINT_JOB_FLOW,
  PRINT_JOB_STATUS_LABELS,
  type PrintJobListItem,
  PrintJobStatus,
} from '@forgea/types';
import { ConfirmButton } from '~/components/ui/confirm-button';
import { UpdatePrintJobDto } from '@forgea/validation';
import { Link, useFetcher } from 'react-router';
import { Money } from '~/components/money';
import { Button } from '~/components/ui/button';
import { CheckboxField, Field } from '~/components/ui/field';
import { useCan } from '~/features/admin/access';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { StatusBar } from '~/features/admin/views';
import { PrinterField, ReelField } from '~/features/production/choice-fields';
import { productionChoices } from '~/features/production/choices.server';
import {
  PRINT_JOB_ASIDE,
  PRINT_JOB_STEPS,
} from '~/features/production/print-job-steps';
import { apiContext } from '~/lib/request.server';
import { fromStudioInput, studioFormat, studioInput } from '~/lib/studio-time';
import type { Route } from './+types/route';
import { formatHours } from '~/lib/duration';

export async function loader({ url, params, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const [r, choices] = await Promise.all([
    api.get<PrintJobListItem>(`/print-jobs/${encodeURIComponent(params.id)}`),
    productionChoices(api),
  ]);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  // Dropped on Scheduled or Done in the kanban: straight to what that step needs.
  return {
    job: r.data,
    ...choices,
    plan: url.searchParams.has('plan'),
    finish: url.searchParams.has('finish'),
  };
}

/** plan | schedule | finish | fail | status: each one PATCH; the API refuses what isn't allowed. */
export async function action({ request, params, context }: Route.ActionArgs) {
  const form = await request.formData();
  const send = (dto: UpdatePrintJobDto) =>
    context
      .get(apiContext)
      .patch(`/print-jobs/${encodeURIComponent(params.id)}`, dto);
  switch (form.get('intent')) {
    case 'plan':
      return save(
        UpdatePrintJobDto,
        {
          printerId: text(form, 'printerId'),
          stockItemId: text(form, 'stockItemId'),
          quantity: text(form, 'quantity'),
          grams: text(form, 'grams'),
          hours: text(form, 'hours'),
        },
        send,
      );
    case 'schedule': {
      const when = text(form, 'scheduledDate');
      return save(
        UpdatePrintJobDto,
        { scheduledDate: when ? fromStudioInput(when) : null },
        send,
      );
    }
    case 'finish':
      return save(
        UpdatePrintJobDto,
        {
          status: PrintJobStatus.DONE,
          actualGrams: text(form, 'actualGrams'),
          actualHours: text(form, 'actualHours'),
          goodPieces: text(form, 'goodPieces'),
          sparePieces: text(form, 'sparePieces'),
          actualKwh: text(form, 'actualKwh'),
          note: text(form, 'note'),
          reprint: form.get('reprint') === 'on',
        },
        send,
      );
    case 'fail':
      return save(
        UpdatePrintJobDto,
        {
          status: PrintJobStatus.FAILED,
          actualGrams: text(form, 'actualGrams'),
          actualHours: text(form, 'actualHours'),
          note: text(form, 'note'),
          reprint: form.get('reprint') === 'on',
        },
        send,
      );
    default:
      return save(UpdatePrintJobDto, { status: text(form, 'status') }, send);
  }
}

const FULL = studioFormat({ dateStyle: 'full', timeStyle: 'short' });
const when = (iso: string) => FULL.format(new Date(iso));

export default function PrintJobPage({ loaderData }: Route.ComponentProps) {
  const { job, printers, reels, plan, finish } = loaderData;
  const step = useFetcher<SaveResult>();
  const planning = useFetcher<SaveResult>();
  const schedule = useFetcher<SaveResult>();
  const done = useFetcher<SaveResult>();
  const failed = useFetcher<SaveResult>();
  const mayWork = useCan()('production.manage');
  const open =
    job.status === PrintJobStatus.QUEUED ||
    job.status === PrintJobStatus.SCHEDULED ||
    job.status === PrintJobStatus.PRINTING;
  // Scheduling takes a date, finishing and failing take figures: not plain steps.
  const next = PRINT_JOB_FLOW[job.status].filter(
    (s) =>
      s !== PrintJobStatus.SCHEDULED &&
      s !== PrintJobStatus.DONE &&
      s !== PrintJobStatus.FAILED,
  );
  const canFinish = PRINT_JOB_FLOW[job.status].includes(PrintJobStatus.DONE);
  const canFail = PRINT_JOB_FLOW[job.status].includes(PrintJobStatus.FAILED);
  const ready = job.printer !== null && job.reel !== null;
  const errors = planning.data?.errors ?? {};
  return (
    <>
      <AdminHeader
        trail={[{ label: 'Production', to: '/admin/production' }]}
        title={`${job.quantity} × ${job.item?.name ?? 'Print run'}`}
        intro={`Order ${job.orderNumber} · about ${job.grams} g, ${formatHours(job.hours)}${
          job.printer ? ` on ${job.printer.name}` : ''
        }${job.reel ? `, ${job.reel.material} ${job.reel.colour}` : ''}.`}
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
      {open && !ready && (
        <p
          role="status"
          className="mb-6 rounded-lg border-2 border-accent bg-surface p-4 text-sm"
        >
          Choose its <strong>printer</strong> and <strong>reel</strong> below
          before it can be scheduled or started.
        </p>
      )}
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
              {job.item && ` · ${job.item.name}`}
            </dd>
            <dt className="text-text-muted">Pieces</dt>
            <dd>{job.quantity}</dd>
            <dt className="text-text-muted">Printer</dt>
            <dd>{job.printer?.name ?? 'Not chosen'}</dd>
            <dt className="text-text-muted">Reel</dt>
            <dd>
              {job.reel
                ? `${job.reel.material} · ${job.reel.colour || 'no colour'}`
                : 'Not chosen'}
            </dd>
            <dt className="text-text-muted">Estimate</dt>
            <dd>
              {job.grams} g · {formatHours(job.hours)}
            </dd>
            {job.actualGrams && (
              <>
                <dt className="text-text-muted">
                  {job.status === PrintJobStatus.FAILED
                    ? 'Lost'
                    : 'Really took'}
                </dt>
                <dd>
                  {job.actualGrams} g
                  {job.actualHours ? ` · ${formatHours(job.actualHours)}` : ''}
                </dd>
              </>
            )}
            {job.goodPieces !== null && (
              <>
                <dt className="text-text-muted">Came out right</dt>
                <dd>
                  {job.goodPieces} of {job.quantity}
                  {job.sparePieces > 0 &&
                    `, and ${job.sparePieces} spare to the ready pieces`}
                </dd>
              </>
            )}
            {job.note && (
              <>
                <dt className="text-text-muted">Note</dt>
                <dd>{job.note}</dd>
              </>
            )}
            {job.replaces && (
              <>
                <dt className="text-text-muted">Reprint of</dt>
                <dd>
                  <Link
                    to={`/admin/production/${job.replaces}`}
                    className="underline"
                  >
                    an earlier run
                  </Link>
                </dd>
              </>
            )}
            {job.reprints.length > 0 && (
              <>
                <dt className="text-text-muted">Reprinted in</dt>
                <dd className="flex flex-wrap gap-x-3">
                  {job.reprints.map((id, i) => (
                    <Link
                      key={id}
                      to={`/admin/production/${id}`}
                      className="underline"
                    >
                      run {i + 1}
                    </Link>
                  ))}
                </dd>
              </>
            )}
            <dt className="text-text-muted">Scheduled</dt>
            <dd>{job.scheduledDate ? when(job.scheduledDate) : 'Not yet'}</dd>
            {job.finishedAt && (
              <>
                <dt className="text-text-muted">Finished</dt>
                <dd>{when(job.finishedAt)}</dd>
              </>
            )}
          </dl>
        </Panel>
        {job.cost && (
          <Panel title="What it really cost">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
              <dt className="text-text-muted">Filament</dt>
              <dd>
                <Money amount={job.cost.material} />
              </dd>
              <dt className="text-text-muted">Electricity</dt>
              <dd>
                <Money amount={job.cost.electricity} /> (
                {job.cost.electricityKwh} kWh)
              </dd>
              <dt className="text-text-muted">Printer wear</dt>
              <dd>
                <Money amount={job.cost.wear} />
              </dd>
              <dt className="font-semibold">Total</dt>
              <dd className="font-semibold">
                <Money amount={job.cost.total} />
              </dd>
            </dl>
          </Panel>
        )}
        {mayWork && open && (
          <Panel title="Plan it">
            <planning.Form method="post" className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="plan" />
              <PrinterField
                printers={printers}
                value={job.printer?.id}
                error={errors['printerId']}
              />
              <ReelField
                reels={reels}
                value={job.reel?.id}
                error={errors['stockItemId']}
              />
              <Field
                label="Pieces"
                name="quantity"
                type="number"
                min={1}
                defaultValue={job.quantity}
                error={errors['quantity']}
              />
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Grams (estimate)"
                  name="grams"
                  inputMode="decimal"
                  defaultValue={job.grams}
                  error={errors['grams']}
                />
                <Field
                  label="Hours (estimate)"
                  name="hours"
                  inputMode="decimal"
                  defaultValue={job.hours}
                  error={errors['hours']}
                />
              </div>
              <div className="flex items-center gap-3 sm:col-span-2">
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={planning.state !== 'idle'}
                >
                  Save the plan
                </Button>
                <SaveStatus state={planning.state} result={planning.data} />
              </div>
            </planning.Form>
            {job.status !== PrintJobStatus.PRINTING && (
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
                  disabled={schedule.state !== 'idle' || !ready}
                >
                  {job.scheduledDate ? 'Move' : 'Schedule'}
                </Button>
                <SaveStatus state={schedule.state} result={schedule.data} />
              </schedule.Form>
            )}
          </Panel>
        )}
        {mayWork && canFinish && (
          <Panel title="Finished: what it really took">
            <done.Form method="post" className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="finish" />
              <Field
                label="Grams used (weigh the pieces and supports)"
                name="actualGrams"
                inputMode="decimal"
                required
                autoFocus={finish}
                defaultValue={job.grams}
                error={done.data?.errors?.['actualGrams']}
              />
              <Field
                label="Hours it took"
                name="actualHours"
                inputMode="decimal"
                required
                defaultValue={job.hours}
                error={done.data?.errors?.['actualHours']}
              />
              <Field
                label="Pieces that came out right"
                name="goodPieces"
                type="number"
                min={0}
                max={job.quantity}
                defaultValue={job.quantity}
                hint={`Of ${job.quantity}; the others are lost`}
                error={done.data?.errors?.['goodPieces']}
              />
              <Field
                label="Spare good pieces (optional)"
                name="sparePieces"
                type="number"
                min={0}
                defaultValue={0}
                hint="Beyond what it was for: they go to the ready pieces"
                error={done.data?.errors?.['sparePieces']}
              />
              <Field
                label="Energy used, kWh (optional)"
                name="actualKwh"
                inputMode="decimal"
                hint={`From the printer or a plug meter; empty: ${job.printer?.name ?? 'the printer'}'s watts × the hours`}
                error={done.data?.errors?.['actualKwh']}
              />
              <Field
                label="Note (optional)"
                name="note"
                placeholder="e.g. one warped at the corner"
                error={done.data?.errors?.['note']}
              />
              <div className="sm:col-span-2">
                <CheckboxField
                  label="Plan a reprint of the pieces that didn't come out right"
                  name="reprint"
                  defaultChecked
                />
              </div>
              <div className="flex items-center gap-3 sm:col-span-2">
                <Button
                  type="submit"
                  disabled={done.state !== 'idle' || !ready}
                >
                  Mark as done
                </Button>
                <SaveStatus state={done.state} result={done.data} />
              </div>
              <p className="text-xs text-text-muted sm:col-span-2">
                Stock moves by the difference from the estimate, and the real
                cost (filament, electricity, printer wear) goes on the order and
                the production results.
              </p>
            </done.Form>
          </Panel>
        )}
        {mayWork && canFail && (
          <Panel title="It failed">
            <failed.Form method="post" className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="fail" />
              <Field
                label="Grams lost (empty: the estimate)"
                name="actualGrams"
                inputMode="decimal"
                error={failed.data?.errors?.['actualGrams']}
              />
              <Field
                label="Hours it ran (optional)"
                name="actualHours"
                inputMode="decimal"
                error={failed.data?.errors?.['actualHours']}
              />
              <Field
                label="What went wrong (optional)"
                name="note"
                placeholder="e.g. came off the bed"
                error={failed.data?.errors?.['note']}
              />
              <div className="sm:col-span-2">
                <CheckboxField
                  label="Plan a reprint"
                  name="reprint"
                  defaultChecked
                />
              </div>
              <div className="flex items-center gap-3 sm:col-span-2">
                <ConfirmButton
                  disabled={failed.state !== 'idle'}
                  question="Mark this print as failed? Its filament leaves stock."
                  yes="Yes, it failed"
                >
                  Mark as failed
                </ConfirmButton>
                <SaveStatus state={failed.state} result={failed.data} />
              </div>
            </failed.Form>
          </Panel>
        )}
      </div>
    </>
  );
}
