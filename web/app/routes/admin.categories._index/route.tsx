import type { CategoryView } from '@forgea/types';
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
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

const FILTERS = [
  { key: 'shown', label: 'Visible', only: 'active' },
  { key: 'hidden', label: 'Hidden', only: 'active' },
];

const DEFAULTS = {
  sorts: ['sortOrder', 'name', 'slug'],
  order: 'asc',
} as const;

export async function loader({ url, context }: Route.LoaderArgs) {
  const state = listState(url.searchParams, DEFAULTS);
  const r = await context
    .get(apiContext)
    .get<CategoryView[]>('/categories/manage');
  if (!r.ok) throw new Response(r.message, { status: r.status });
  const on = (key: string) => state.filters.includes(key);
  const items = r.data.filter(
    (c) => (!on('shown') || c.active) && (!on('hidden') || !c.active),
  );
  return {
    state,
    categories: localList(
      items,
      state,
      {
        text: (c) => `${c.name} ${c.slug} ${c.description ?? ''}`,
        sorts: {
          sortOrder: (c) => c.sortOrder,
          name: (c) => c.name,
          slug: (c) => c.slug,
        },
      },
      state.view === 'kanban' ? 200 : 50,
    ),
  };
}

const COLUMNS: ListColumn<CategoryView>[] = [
  { key: 'name', label: 'Category', sort: 'name', cell: (c) => c.name },
  {
    key: 'slug',
    label: 'Web address',
    sort: 'slug',
    cell: (c) => <span className="text-text-muted">{c.slug}</span>,
  },
  {
    key: 'description',
    label: 'Description',
    cell: (c) => (
      <span className="text-text-muted">{c.description ?? '—'}</span>
    ),
  },
  {
    key: 'sortOrder',
    label: 'Order',
    sort: 'sortOrder',
    align: 'right',
    cell: (c) => c.sortOrder,
  },
  {
    key: 'active',
    label: 'In the shop',
    cell: (c) =>
      c.active ? 'Visible' : <span className="text-text-muted">Hidden</span>,
  },
];

const href = (c: CategoryView) => `/admin/categories/${c.id}`;

export default function Categories({ loaderData }: Route.ComponentProps) {
  const { state, categories } = loaderData;
  const mayAdd = useCan()('catalog.manage');
  return (
    <>
      <AdminHeader
        title="Categories"
        intro="Sections of the shop. Customers filter by them; hidden ones disappear from the shop but keep their products."
        action={
          mayAdd ? (
            <Link to="/admin/categories/new" className={buttonClass()}>
              New category
            </Link>
          ) : undefined
        }
      />
      <ControlPanel
        state={state}
        search="Name or web address"
        filters={FILTERS}
        views={['list', 'kanban']}
        {...(state.view === 'list'
          ? {
              page: {
                shown: categories.items.length,
                total: categories.total,
                nextCursor: categories.nextCursor,
              },
            }
          : {})}
      />
      {state.view === 'kanban' ? (
        <KanbanView
          href={href}
          layout="grid"
          columns={[
            { key: 'all', title: 'Categories', items: categories.items },
          ]}
          title={(c) => c.name}
          card={(c) => (
            <>
              <span className="text-text-muted">/shop?category={c.slug}</span>
              {c.description && <span>{c.description}</span>}
              <span className="flex justify-between text-text-muted">
                <span>Order {c.sortOrder}</span>
                {!c.active && <span>Hidden</span>}
              </span>
            </>
          )}
        />
      ) : (
        <ListView
          label="Categories"
          rows={categories.items}
          columns={COLUMNS}
          href={href}
          state={state}
          empty={
            mayAdd
              ? 'No categories here. Add one with New category.'
              : 'No categories here.'
          }
        />
      )}
    </>
  );
}
