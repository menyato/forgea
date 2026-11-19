import type { LogoView } from '@forgea/types';
import { Link } from 'react-router';
import { buttonClass } from '~/components/ui/button';
import { useCan } from '~/features/admin/access';
import { AdminHeader } from '~/features/admin/admin-ui';
import { listState, localList } from '~/features/admin/list-state';
import {
  ControlPanel,
  type ListColumn,
  ListView,
} from '~/features/admin/views';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

const FILTERS = [
  { key: 'offered', label: 'Offered', only: 'active' },
  { key: 'off', label: 'Not offered', only: 'active' },
];

const DEFAULTS = { sorts: ['sortOrder', 'name'], order: 'asc' } as const;

export async function loader({ url, context }: Route.LoaderArgs) {
  const state = listState(url.searchParams, DEFAULTS);
  const r = await context.get(apiContext).get<LogoView[]>('/logos');
  if (!r.ok) throw new Response(r.message, { status: r.status });
  const on = (key: string) => state.filters.includes(key);
  const items = r.data.filter(
    (l) => (!on('offered') || l.active) && (!on('off') || !l.active),
  );
  return {
    state,
    logos: localList(items, state, {
      text: (l) => l.name,
      sorts: { sortOrder: (l) => l.sortOrder, name: (l) => l.name },
    }),
  };
}

const COLUMNS: ListColumn<LogoView>[] = [
  { key: 'name', label: 'Logo', sort: 'name', cell: (l) => l.name },
  {
    key: 'points',
    label: 'Detail',
    align: 'right',
    cell: (l) => `${l.points.toLocaleString('en-US')} points`,
  },
  {
    key: 'sortOrder',
    label: 'Order',
    sort: 'sortOrder',
    align: 'right',
    cell: (l) => l.sortOrder,
  },
  {
    key: 'active',
    label: 'Offered',
    cell: (l) =>
      l.active ? 'Yes' : <span className="text-text-muted">Not offered</span>,
  },
];

const href = (l: LogoView) => `/admin/logos/${l.id}`;

export default function Logos({ loaderData }: Route.ComponentProps) {
  const { state, logos } = loaderData;
  const mayAdd = useCan()('catalog.manage');
  return (
    <>
      <AdminHeader
        title="Logos"
        intro="Drawings the studio prints on products: a logo on a keychain, a badge on a stand. Add one as an SVG; on a product's page, put it where it should print and say whether customers may turn it off."
        action={
          mayAdd ? (
            <Link to="/admin/logos/new" className={buttonClass()}>
              New logo
            </Link>
          ) : undefined
        }
      />
      <ControlPanel
        state={state}
        search="Logo name"
        filters={FILTERS}
        page={{
          shown: logos.items.length,
          total: logos.total,
          nextCursor: logos.nextCursor,
        }}
      />
      <ListView
        label="Logos"
        rows={logos.items}
        columns={COLUMNS}
        href={href}
        state={state}
        empty={
          mayAdd ? 'No logos here. Add one with New logo.' : 'No logos here.'
        }
      />
    </>
  );
}
