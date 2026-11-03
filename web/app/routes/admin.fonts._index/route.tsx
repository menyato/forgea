import type { FontView } from '@forgea/types';
import { Link } from 'react-router';
import { buttonClass } from '~/components/ui/button';
import { useCan } from '~/features/admin/access';
import { AdminHeader } from '~/features/admin/admin-ui';
import { listState, localList } from '~/features/admin/list-state';
import {
  ControlPanel,
  KanbanView,
  type ListColumn,
  ListView,
} from '~/features/admin/views';
import { FontSample, scriptsOf } from '~/features/admin-fonts/font-sample';
import { useFontFaces } from '~/features/text-studio/use-font-faces';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

const FILTERS = [
  { key: 'offered', label: 'Offered', only: 'active' },
  { key: 'off', label: 'Not offered', only: 'active' },
  { key: 'latin', label: 'Writes English', apart: true },
  { key: 'arabic', label: 'Writes Arabic', apart: true },
];

const DEFAULTS = { sorts: ['sortOrder', 'name'], order: 'asc' } as const;

export async function loader({ url, context }: Route.LoaderArgs) {
  const state = listState(url.searchParams, DEFAULTS);
  const r = await context.get(apiContext).get<FontView[]>('/fonts');
  if (!r.ok) throw new Response(r.message, { status: r.status });
  const on = (key: string) => state.filters.includes(key);
  const items = r.data.filter(
    (f) =>
      (!on('offered') || f.active) &&
      (!on('off') || !f.active) &&
      (!on('latin') || f.latin) &&
      (!on('arabic') || f.arabic),
  );
  return {
    state,
    fonts: localList(
      items,
      state,
      {
        text: (f) => f.name,
        sorts: { sortOrder: (f) => f.sortOrder, name: (f) => f.name },
      },
      state.view === 'kanban' ? 200 : 50,
    ),
  };
}

const COLUMNS: ListColumn<FontView>[] = [
  { key: 'name', label: 'Font', sort: 'name', cell: (f) => f.name },
  {
    key: 'sample',
    label: 'Sample',
    cell: (f) => <FontSample font={f} className="max-w-64 text-xl" />,
  },
  { key: 'writes', label: 'Writes', cell: scriptsOf },
  {
    key: 'sortOrder',
    label: 'Order',
    sort: 'sortOrder',
    align: 'right',
    cell: (f) => f.sortOrder,
  },
  {
    key: 'active',
    label: 'Offered',
    cell: (f) =>
      f.active ? 'Yes' : <span className="text-text-muted">Not offered</span>,
  },
];

const href = (f: FontView) => `/admin/fonts/${f.id}`;

export default function Fonts({ loaderData }: Route.ComponentProps) {
  const { state, fonts } = loaderData;
  const mayAdd = useCan()('catalog.manage');
  useFontFaces(fonts.items);
  return (
    <>
      <AdminHeader
        title="Fonts"
        intro="The lettering customers choose for personalised pieces (keychains, names, initials). Each font is checked when it is added: whether it writes English, Arabic or both."
        action={
          mayAdd ? (
            <Link to="/admin/fonts/new" className={buttonClass()}>
              New font
            </Link>
          ) : undefined
        }
      />
      <ControlPanel
        state={state}
        search="Font name"
        filters={FILTERS}
        views={['list', 'kanban']}
        {...(state.view === 'list'
          ? {
              page: {
                shown: fonts.items.length,
                total: fonts.total,
                nextCursor: fonts.nextCursor,
              },
            }
          : {})}
      />
      {state.view === 'kanban' ? (
        <KanbanView
          href={href}
          layout="grid"
          columns={[{ key: 'all', title: 'Fonts', items: fonts.items }]}
          title={(f) => f.name}
          card={(f) => (
            <>
              <FontSample font={f} className="text-2xl" />
              <span className="flex justify-between text-text-muted">
                <span>Writes {scriptsOf(f)}</span>
                {!f.active && <span>Not offered</span>}
              </span>
            </>
          )}
        />
      ) : (
        <ListView
          label="Fonts"
          rows={fonts.items}
          columns={COLUMNS}
          href={href}
          state={state}
          empty={
            mayAdd ? 'No fonts here. Add one with New font.' : 'No fonts here.'
          }
        />
      )}
    </>
  );
}
