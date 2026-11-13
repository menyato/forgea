import { OptionKind, type OptionGroupView } from '@forgea/types';
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
import { kindLabel } from '~/features/admin-options/group-form';
import { Swatch } from '~/features/stock/stock-ui';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

const FILTERS = [
  { key: 'offered', label: 'Offered', only: 'active' },
  { key: 'off', label: 'Not offered', only: 'active' },
  { key: 'choice', label: 'Pick from a list', only: 'kind' },
  { key: 'text', label: 'Type a text', only: 'kind' },
];

const GROUPS = [{ key: 'kind', label: 'Type' }];

const DEFAULTS = {
  sorts: ['sortOrder', 'name', 'values'],
  order: 'asc',
} as const;

export async function loader({ url, context }: Route.LoaderArgs) {
  const state = listState(url.searchParams, DEFAULTS);
  const r = await context
    .get(apiContext)
    .get<OptionGroupView[]>('/option-groups');
  if (!r.ok) throw new Response(r.message, { status: r.status });
  const on = (key: string) => state.filters.includes(key);
  const items = r.data.filter(
    (g) =>
      (!on('offered') || g.active) &&
      (!on('off') || !g.active) &&
      (!on('choice') || g.kind === OptionKind.CHOICE) &&
      (!on('text') || g.kind === OptionKind.TEXT),
  );
  return {
    state,
    groups: localList(
      items,
      state,
      {
        text: (g) => `${g.name} ${g.values.map((v) => v.label).join(' ')}`,
        sorts: {
          sortOrder: (g) => g.sortOrder,
          name: (g) => g.name,
          values: (g) => g.values.length,
        },
      },
      state.view === 'kanban' ? 200 : 50,
    ),
  };
}

/** "Red, Blue, Green +4" */
function choicesText(g: OptionGroupView): string {
  if (g.kind === OptionKind.TEXT)
    return `Up to ${g.maxLength ?? '—'} characters`;
  if (g.values.length === 0) return 'No choices yet';
  const shown = g.values.slice(0, 4).map((v) => v.label);
  const more = g.values.length - shown.length;
  return `${shown.join(', ')}${more > 0 ? ` +${more}` : ''}`;
}

function Swatches({ group }: { group: OptionGroupView }) {
  const colours = group.values.filter((v) => v.swatchHex).slice(0, 8);
  if (colours.length === 0) return null;
  return (
    <span className="flex gap-1">
      {colours.map((v) => (
        <Swatch key={v.id} hex={v.swatchHex} />
      ))}
    </span>
  );
}

const COLUMNS: ListColumn<OptionGroupView>[] = [
  { key: 'name', label: 'Option', sort: 'name', cell: (g) => g.name },
  { key: 'kind', label: 'Type', cell: (g) => kindLabel(g.kind) },
  {
    key: 'values',
    label: 'Choices',
    sort: 'values',
    cell: (g) => (
      <span className="inline-flex items-center gap-2 text-text-muted">
        <Swatches group={g} />
        {choicesText(g)}
      </span>
    ),
  },
  {
    key: 'sortOrder',
    label: 'Order',
    sort: 'sortOrder',
    align: 'right',
    cell: (g) => g.sortOrder,
  },
  {
    key: 'active',
    label: 'Offered',
    cell: (g) =>
      g.active ? 'Yes' : <span className="text-text-muted">Not offered</span>,
  },
];

const href = (g: OptionGroupView) => `/admin/options/${g.id}`;

export default function Options({ loaderData }: Route.ComponentProps) {
  const { state, groups } = loaderData;
  const mayAdd = useCan()('catalog.manage');
  const byKind = state.group === 'kind';
  const kinds = [OptionKind.CHOICE, OptionKind.TEXT];
  return (
    <>
      <AdminHeader
        title="Options"
        intro="What customers can choose on a product — colour, size, material, a name to print — and what each choice does to the price. Products pick which of these they offer."
        action={
          mayAdd ? (
            <Link to="/admin/options/new" className={buttonClass()}>
              New option
            </Link>
          ) : undefined
        }
      />
      <ControlPanel
        state={state}
        search="Option or choice"
        filters={FILTERS}
        groups={GROUPS}
        views={['list', 'kanban']}
        {...(state.view === 'list'
          ? {
              page: {
                shown: groups.items.length,
                total: groups.total,
                nextCursor: groups.nextCursor,
              },
            }
          : {})}
      />
      {state.view === 'kanban' ? (
        <KanbanView
          href={href}
          layout={byKind ? 'columns' : 'grid'}
          columns={
            byKind
              ? kinds.map((k) => ({
                  key: k,
                  title: kindLabel(k),
                  items: groups.items.filter((g) => g.kind === k),
                }))
              : [{ key: 'all', title: 'Options', items: groups.items }]
          }
          title={(g) => g.name}
          card={(g) => (
            <>
              <span className="text-text-muted">{kindLabel(g.kind)}</span>
              <Swatches group={g} />
              <span className="text-text-muted">{choicesText(g)}</span>
              {!g.active && (
                <span className="text-text-muted">Not offered</span>
              )}
            </>
          )}
        />
      ) : (
        <ListView
          remove="optionGroup"
          label="Options"
          rows={groups.items}
          columns={COLUMNS}
          href={href}
          state={state}
          group={
            byKind
              ? { of: (g) => kindLabel(g.kind), order: kinds.map(kindLabel) }
              : undefined
          }
          empty={
            mayAdd
              ? 'No options here. Add one with New option.'
              : 'No options here.'
          }
        />
      )}
    </>
  );
}
