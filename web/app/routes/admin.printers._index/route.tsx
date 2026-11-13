import type { PrinterView } from '@forgea/types';
import { Link } from 'react-router';
import { Money } from '~/components/money';
import { buttonClass } from '~/components/ui/button';
import { AdminHeader } from '~/features/admin/admin-ui';
import { listState, localList } from '~/features/admin/list-state';
import {
  ControlPanel,
  KanbanView,
  type ListColumn,
  ListView,
} from '~/features/admin/views';
import { printerJobs } from '~/features/production/links';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

const DEFAULTS = { sorts: ['name'], order: 'asc' } as const;

export async function loader({ url, context }: Route.LoaderArgs) {
  const state = listState(url.searchParams, DEFAULTS);
  const r = await context.get(apiContext).get<PrinterView[]>('/printers');
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return {
    state,
    printers: localList(r.data, state, {
      text: (p) => `${p.name} ${p.notes ?? ''}`,
      sorts: { name: (p) => p.name.toLowerCase() },
    }),
  };
}

const COLUMNS: ListColumn<PrinterView>[] = [
  { key: 'name', label: 'Printer', sort: 'name', cell: (p) => p.name },
  {
    key: 'watts',
    label: 'Power',
    align: 'right',
    cell: (p) => `${p.watts} W`,
  },
  {
    key: 'wear',
    label: 'Wear per hour',
    align: 'right',
    cell: (p) => (p.wearPerHour ? <Money amount={p.wearPerHour} /> : '—'),
  },
  {
    key: 'jobs',
    label: 'Jobs',
    align: 'right',
    // Above the row's own link: the count opens this printer's jobs.
    cell: (p) => (
      <Link
        to={printerJobs(p.id)}
        className="relative z-10 underline-offset-4 hover:underline"
      >
        {p.jobs}
      </Link>
    ),
  },
  {
    key: 'active',
    label: 'In use',
    cell: (p) =>
      p.active ? 'Yes' : <span className="text-text-muted">No</span>,
  },
];

export default function Printers({ loaderData }: Route.ComponentProps) {
  const { state, printers } = loaderData;
  return (
    <>
      <AdminHeader
        title="Printers"
        intro="The studio's printers. Every print job runs on one: its power gives the job's electricity, its price over the hours it should last gives the wear each print hour costs."
        trail={[{ label: 'Production', to: '/admin/production' }]}
        action={
          <Link to="/admin/printers/new" className={buttonClass()}>
            Add a printer
          </Link>
        }
      />
      <ControlPanel
        state={state}
        search="Name"
        views={['list', 'kanban']}
        page={{
          shown: printers.items.length,
          total: printers.total,
          nextCursor: printers.nextCursor,
        }}
      />
      {state.view === 'kanban' ? (
        <KanbanView
          href={(p) => `/admin/printers/${p.id}`}
          columns={[
            {
              key: 'on',
              title: 'In use',
              items: printers.items.filter((p) => p.active),
            },
            {
              key: 'off',
              title: 'Switched off',
              items: printers.items.filter((p) => !p.active),
            },
          ]}
          title={(p) => p.name}
          card={(p) => (
            <span className="text-xs text-text-muted">
              {p.watts} W · {p.jobs} job{p.jobs === 1 ? '' : 's'}
              {p.wearPerHour &&
                ` · wear $${Number(p.wearPerHour).toFixed(2)}/h`}
            </span>
          )}
        />
      ) : (
        <ListView
          remove="printer"
          label="Printers"
          rows={printers.items}
          columns={COLUMNS}
          href={(p) => `/admin/printers/${p.id}`}
          state={state}
          empty="No printers yet."
        />
      )}
    </>
  );
}
