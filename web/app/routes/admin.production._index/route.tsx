import {
  type Page,
  PRINT_JOB_STATUS_LABELS,
  type PrintJobCounts,
  type PrintJobListItem,
  PrintJobStatus,
} from '@forgea/types';
import { UpdatePrintJobDto } from '@forgea/validation';
import { Link, redirect } from 'react-router';
import { buttonClass } from '~/components/ui/button';
import { useCan } from '~/features/admin/access';
import { AdminHeader } from '~/features/admin/admin-ui';
import { listState, pageQuery } from '~/features/admin/list-state';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import {
  ControlPanel,
  KanbanView,
  type ListColumn,
  type ListFilter,
  ListView,
} from '~/features/admin/views';
import { PRINT_JOB_ORDER } from '~/features/production/print-job-steps';
import { apiContext } from '~/lib/request.server';
import { studioFormat } from '~/lib/studio-time';
import type { Route } from './+types/route';

const DEFAULTS = { sorts: ['createdAt'], view: 'kanban' } as const;

/** The kanban with no status filter: what is waiting, on, or just came off the printers. */
const BOARD = [
  PrintJobStatus.QUEUED,
  PrintJobStatus.SCHEDULED,
  PrintJobStatus.PRINTING,
  PrintJobStatus.FAILED,
  PrintJobStatus.DONE,
] as const;

const GROUPS = [
  { key: 'status', label: 'Status' },
  { key: 'machine', label: 'Printer' },
  { key: 'day', label: 'Scheduled day' },
];

/** A printer's filter key: its name, kept apart from the status keys. */
const machineKey = (machine: string) =>
  `printer:${encodeURIComponent(machine)}`;

const DAY = studioFormat({
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const AT = studioFormat({ dateStyle: 'medium', timeStyle: 'short' });

const day = (iso: string | null) =>
  iso ? DAY.format(new Date(iso)) : 'Not scheduled';

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const state = listState(url.searchParams, DEFAULTS);
  const kanban = state.view === 'kanban';
  const counted = await api.get<PrintJobCounts>('/print-jobs/counts');
  const counts: PrintJobCounts = counted.ok
    ? counted.data
    : { statuses: {}, machines: {} };
  const machines = Object.keys(counts.machines).sort((a, b) =>
    a.localeCompare(b),
  );
  // The API takes one status and one printer at a time: the filters are alternatives.
  const status = PRINT_JOB_ORDER.find((s) => state.filters.includes(s));
  const machine = machines.find((m) => state.filters.includes(machineKey(m)));

  const query = pageQuery(state, kanban ? 100 : 50);
  if (status) query.set('status', status);
  if (machine) query.set('machine', machine);
  const r = await api.get<Page<PrintJobListItem>>(`/print-jobs?${query}`);
  if (!r.ok) throw new Response(r.message, { status: r.status });

  const all = Object.values(counts.statuses).reduce((n, c) => n + c, 0);
  return {
    state,
    jobs: r.data,
    counts,
    machines,
    // What the pager can promise: known for one filter at a time, not for a search.
    total: state.q
      ? undefined
      : status && machine
        ? undefined
        : status
          ? (counts.statuses[status] ?? 0)
          : machine
            ? counts.machines[machine]
            : all,
    columns: status ? [status] : [...BOARD],
  };
}

/** A card dragged to another column: the same step the job's own buttons take. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const id = text(form, 'id') ?? '';
  const to = text(form, 'to');
  // Scheduling needs a day and a time: dropped on Scheduled, the job's page opens to pick them.
  if (to === PrintJobStatus.SCHEDULED && /^[0-9a-f-]{36}$/.test(id))
    throw redirect(`/admin/production/${id}?plan=1`);
  return save(UpdatePrintJobDto, { status: to }, (dto) =>
    context.get(apiContext).patch(`/print-jobs/${encodeURIComponent(id)}`, dto),
  );
}

const COLUMNS: ListColumn<PrintJobListItem>[] = [
  {
    key: 'order',
    label: 'Order',
    cell: (j) => <span className="font-mono">{j.orderNumber}</span>,
  },
  {
    key: 'material',
    label: 'Material',
    cell: (j) => `${j.material} · ${j.color}`,
  },
  {
    key: 'grams',
    label: 'Grams',
    align: 'right',
    cell: (j) => `${j.grams} g`,
  },
  { key: 'hours', label: 'Hours', align: 'right', cell: (j) => `${j.hours} h` },
  { key: 'machine', label: 'Printer', cell: (j) => j.machine },
  {
    key: 'scheduled',
    label: 'Scheduled',
    cell: (j) => (
      <span className={j.scheduledDate ? '' : 'text-text-muted'}>
        {j.scheduledDate
          ? AT.format(new Date(j.scheduledDate))
          : 'Not scheduled'}
      </span>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    cell: (j) => PRINT_JOB_STATUS_LABELS[j.status],
  },
  {
    key: 'created',
    label: 'Added',
    sort: 'createdAt',
    cell: (j) => (
      <span className="text-text-muted">
        {new Date(j.createdAt).toLocaleDateString('en-GB')}
      </span>
    ),
  },
];

const href = (j: PrintJobListItem) => `/admin/production/${j.id}`;

export default function Production({ loaderData }: Route.ComponentProps) {
  const { state, jobs, counts, machines, total, columns } = loaderData;
  const mayWork = useCan()('production.manage');
  const filters: ListFilter[] = [
    ...PRINT_JOB_ORDER.map((s) => ({
      key: s,
      label: PRINT_JOB_STATUS_LABELS[s],
      count: counts.statuses[s] ?? 0,
      only: 'status',
    })),
    ...machines.map((m) => ({
      key: machineKey(m),
      label: m,
      count: counts.machines[m],
      only: 'printer',
    })),
  ];
  return (
    <>
      <AdminHeader
        title="Production"
        intro="Print runs for each order: plan them on a printer and a day, move them along as they print (drag a card on the kanban). Scheduled runs also appear on the studio's Google Calendar; a failed print takes its filament out of stock."
        action={
          <span className="flex flex-wrap gap-2">
            <Link
              to="/admin/production/calendar"
              className={buttonClass('secondary')}
            >
              Week calendar
            </Link>
            {mayWork && (
              <Link to="/admin/production/new" className={buttonClass()}>
                Plan a print run
              </Link>
            )}
          </span>
        }
      />
      <ControlPanel
        state={state}
        search="Order number, printer or colour"
        filters={filters}
        groups={GROUPS}
        views={['kanban', 'list']}
        {...(state.view === 'list'
          ? {
              page: {
                shown: jobs.items.length,
                total,
                nextCursor: jobs.nextCursor,
              },
            }
          : {})}
      />
      {state.view === 'kanban' ? (
        <KanbanView
          move={mayWork}
          href={href}
          columns={columns.map((s) => ({
            key: s,
            title: PRINT_JOB_STATUS_LABELS[s],
            items: jobs.items.filter((j) => j.status === s),
          }))}
          title={(j) => j.orderNumber}
          card={(j) => (
            <>
              <span className="text-text-muted">
                {j.grams} g {j.material} · {j.color} · {j.hours} h
              </span>
              <span className="flex justify-between gap-2 text-text-muted">
                <span>{j.machine}</span>
                {j.scheduledDate && <span>{day(j.scheduledDate)}</span>}
              </span>
            </>
          )}
        />
      ) : (
        <ListView
          label="Print runs"
          rows={jobs.items}
          columns={COLUMNS}
          href={href}
          state={state}
          empty="No print runs here."
          group={
            state.group === 'status'
              ? {
                  of: (j) => PRINT_JOB_STATUS_LABELS[j.status],
                  order: PRINT_JOB_ORDER.map((s) => PRINT_JOB_STATUS_LABELS[s]),
                }
              : state.group === 'machine'
                ? { of: (j) => j.machine, order: machines }
                : state.group === 'day'
                  ? {
                      of: (j) => day(j.scheduledDate),
                      // Soonest first; "Not scheduled" last.
                      order: [
                        ...new Set(
                          jobs.items
                            .flatMap((j) =>
                              j.scheduledDate ? [j.scheduledDate] : [],
                            )
                            .sort()
                            .map(day),
                        ),
                      ],
                    }
                  : undefined
          }
        />
      )}
    </>
  );
}
