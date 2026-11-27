import {
  type Page,
  PRINT_JOB_STATUS_LABELS,
  type PrinterView,
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
import { studioDate, studioFormat } from '~/lib/studio-time';
import type { Route } from './+types/route';
import { formatHours } from '~/lib/duration';
import { reelsOf } from '~/features/production/reels';

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
  { key: 'printer', label: 'Printer' },
  { key: 'day', label: 'Scheduled day' },
];

/** A printer's filter key: its id ("none": no printer yet), kept apart from the status keys. */
const printerKey = (id: string) => `printer:${id}`;
const NO_PRINTER = { id: 'none', name: 'No printer yet' };
/** What a job prints, for its card and row. */
const what = (j: PrintJobListItem) =>
  `${j.quantity} × ${j.item?.name ?? 'print'}`;
const reel = (j: PrintJobListItem) => reelsOf(j) ?? 'Reel not chosen';

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
  const [counted, listed] = await Promise.all([
    api.get<PrintJobCounts>('/print-jobs/counts'),
    api.get<PrinterView[]>('/printers'),
  ]);
  const counts: PrintJobCounts = counted.ok
    ? counted.data
    : { statuses: {}, printers: {} };
  // Printers with jobs, by name; jobs with no printer yet as one more.
  const printers = [
    ...(listed.ok ? listed.data : [])
      .filter((p) => counts.printers[p.id])
      .map((p) => ({ id: p.id, name: p.name })),
    ...(counts.printers['none'] ? [NO_PRINTER] : []),
  ];
  // The API takes one status and one printer at a time: the filters are alternatives.
  const status = PRINT_JOB_ORDER.find((s) => state.filters.includes(s));
  const printer = printers.find((m) =>
    state.filters.includes(printerKey(m.id)),
  );

  const query = pageQuery(state, kanban ? 100 : 50);
  if (status) query.set('status', status);
  if (printer) query.set('printer', printer.id);
  const r = await api.get<Page<PrintJobListItem>>(`/print-jobs?${query}`);
  if (!r.ok) throw new Response(r.message, { status: r.status });

  const all = Object.values(counts.statuses).reduce((n, c) => n + c, 0);
  return {
    state,
    jobs: r.data,
    counts,
    printers,
    // What the pager can promise: known for one filter at a time, not for a search.
    total: state.q
      ? undefined
      : status && printer
        ? undefined
        : status
          ? (counts.statuses[status] ?? 0)
          : printer
            ? counts.printers[printer.id]
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
  // Done needs what it really took: dropped on Done, the job's page asks for it.
  if (to === PrintJobStatus.DONE && /^[0-9a-f-]{36}$/.test(id))
    throw redirect(`/admin/production/${id}?finish=1`);
  return save(UpdatePrintJobDto, { status: to }, (dto) =>
    context.get(apiContext).patch(`/print-jobs/${encodeURIComponent(id)}`, dto),
  );
}

const COLUMNS: ListColumn<PrintJobListItem>[] = [
  {
    key: 'order',
    label: 'Order',
    cell: (j) => (
      <span className="font-mono whitespace-nowrap">{j.orderNumber}</span>
    ),
  },
  { key: 'what', label: 'Prints', cell: what },
  {
    key: 'reel',
    label: 'Reel',
    cell: (j) => <span className={j.reel ? '' : 'text-danger'}>{reel(j)}</span>,
  },
  {
    key: 'grams',
    label: 'Grams',
    align: 'right',
    cell: (j) => (j.actualGrams ? `${j.actualGrams} g used` : `${j.grams} g`),
  },
  {
    key: 'hours',
    label: 'Hours',
    align: 'right',
    cell: (j) =>
      j.actualHours
        ? `${formatHours(j.actualHours)} taken`
        : formatHours(j.hours),
  },
  {
    key: 'printer',
    label: 'Printer',
    cell: (j) => (
      <span className={j.printer ? '' : 'text-danger'}>
        {j.printer?.name ?? 'Not chosen'}
      </span>
    ),
  },
  {
    key: 'cost',
    label: 'Real cost',
    align: 'right',
    cell: (j) => (j.cost ? `$${j.cost.total}` : '—'),
  },
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
      <span className="text-text-muted">{studioDate(j.createdAt)}</span>
    ),
  },
];

const href = (j: PrintJobListItem) => `/admin/production/${j.id}`;

export default function Production({ loaderData }: Route.ComponentProps) {
  const { state, jobs, counts, printers, total, columns } = loaderData;
  const mayWork = useCan()('production.manage');
  const filters: ListFilter[] = [
    ...PRINT_JOB_ORDER.map((s) => ({
      key: s,
      label: PRINT_JOB_STATUS_LABELS[s],
      count: counts.statuses[s] ?? 0,
      only: 'status',
    })),
    ...printers.map((m) => ({
      key: printerKey(m.id),
      label: m.name,
      count: counts.printers[m.id],
      only: 'printer',
    })),
  ];
  return (
    <>
      <AdminHeader
        title="Production"
        intro="A print run for each order line, made by itself when the order goes into production. Choose the printer and the reel, schedule it, and when it is done enter the grams and hours it really took: stock follows, and its real cost (filament, electricity, printer wear) goes on the order. Scheduled runs also appear on the studio's Google Calendar."
        action={
          <span className="flex flex-wrap gap-2">
            <Link to="/admin/printers" className={buttonClass('secondary')}>
              Printers
            </Link>
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
        search="Order number, item, printer or colour"
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
              <span>{what(j)}</span>
              <span className="text-text-muted">
                {reel(j)} · {j.actualGrams ?? j.grams} g ·{' '}
                {formatHours(j.actualHours ?? j.hours)}
              </span>
              <span className="flex justify-between gap-2 text-text-muted">
                <span className={j.printer ? '' : 'text-danger'}>
                  {j.printer?.name ?? 'No printer yet'}
                </span>
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
          group={(k) =>
            k === 'status'
              ? {
                  of: (j) => PRINT_JOB_STATUS_LABELS[j.status],
                  order: PRINT_JOB_ORDER.map((s) => PRINT_JOB_STATUS_LABELS[s]),
                }
              : k === 'printer'
                ? {
                    of: (j) => j.printer?.name ?? NO_PRINTER.name,
                    order: printers.map((m) => m.name),
                  }
                : k === 'day'
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
