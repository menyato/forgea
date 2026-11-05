import type { PrinterView } from '@forgea/types';
import { Link } from 'react-router';
import { Money } from '~/components/money';
import { buttonClass } from '~/components/ui/button';
import { AdminHeader } from '~/features/admin/admin-ui';
import { listState, localList } from '~/features/admin/list-state';
import {
  ControlPanel,
  type ListColumn,
  ListView,
} from '~/features/admin/views';
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
  { key: 'jobs', label: 'Jobs', align: 'right', cell: (p) => p.jobs },
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
        page={{
          shown: printers.items.length,
          total: printers.total,
          nextCursor: printers.nextCursor,
        }}
      />
      <ListView
        label="Printers"
        rows={printers.items}
        columns={COLUMNS}
        href={(p) => `/admin/printers/${p.id}`}
        state={state}
        empty="No printers yet."
      />
    </>
  );
}
