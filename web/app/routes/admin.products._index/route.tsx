import type { AdminProductListItem, Page } from '@forgea/types';
import { Link } from 'react-router';
import { Money } from '~/components/money';
import { buttonClass } from '~/components/ui/button';
import { useCan } from '~/features/admin/access';
import { AdminHeader } from '~/features/admin/admin-ui';
import { listState, pageQuery } from '~/features/admin/list-state';
import {
  ControlPanel,
  KanbanView,
  type ListColumn,
  ListView,
} from '~/features/admin/views';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

const FILTERS = [
  { key: 'shown', label: 'In the shop', only: 'active' },
  { key: 'hidden', label: 'Hidden', only: 'active' },
  { key: 'with3d', label: 'With a 3D model', only: 'model' },
  { key: 'no3d', label: 'Without a 3D model', only: 'model' },
];

const GROUPS = [
  { key: 'category', label: 'Category' },
  { key: 'material', label: 'Material' },
];

const DEFAULTS = { sorts: ['name'], order: 'asc' } as const;

export async function loader({ url, context }: Route.LoaderArgs) {
  const state = listState(url.searchParams, DEFAULTS);
  const query = pageQuery(state, state.view === 'kanban' ? 100 : 50);
  if (state.filters.includes('shown')) query.set('active', 'true');
  else if (state.filters.includes('hidden')) query.set('active', 'false');
  if (state.filters.includes('with3d')) query.set('model', 'with');
  else if (state.filters.includes('no3d')) query.set('model', 'without');
  const r = await context
    .get(apiContext)
    .get<Page<AdminProductListItem>>(`/products/manage?${query}`);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { state, products: r.data };
}

const category = (p: AdminProductListItem) => p.category ?? 'No category';

const COLUMNS: ListColumn<AdminProductListItem>[] = [
  { key: 'name', label: 'Product', sort: 'name', cell: (p) => p.name },
  { key: 'category', label: 'Category', cell: (p) => p.category ?? '—' },
  { key: 'material', label: 'Material', cell: (p) => p.material },
  { key: 'model', label: '3D', cell: (p) => (p.hasModel ? 'Yes' : '—') },
  {
    key: 'price',
    label: 'From',
    align: 'right',
    cell: (p) => <Money amount={p.price} />,
  },
  {
    key: 'active',
    label: 'In shop',
    cell: (p) =>
      p.active ? 'Visible' : <span className="text-text-muted">Hidden</span>,
  },
  {
    key: 'changed',
    label: 'Last changed',
    cell: (p) => (
      <span className="text-text-muted">
        {new Date(p.updatedAt).toLocaleDateString('en-GB')}
      </span>
    ),
  },
];

const href = (p: AdminProductListItem) => `/admin/products/${p.id}`;

export default function Products({ loaderData }: Route.ComponentProps) {
  const { state, products } = loaderData;
  const mayAdd = useCan()('catalog.manage');
  const groupOf =
    state.group === 'category'
      ? category
      : state.group === 'material'
        ? (p: AdminProductListItem) => p.material
        : undefined;
  return (
    <>
      <AdminHeader
        title="Products"
        intro="Everything in the shop. Prices come from the materials, the pricing settings and each product's options."
        action={
          mayAdd ? (
            <Link to="/admin/products/new" className={buttonClass()}>
              New product
            </Link>
          ) : undefined
        }
      />
      <ControlPanel
        state={state}
        search="Product name"
        filters={FILTERS}
        groups={GROUPS}
        views={['list', 'kanban']}
        {...(state.view === 'list'
          ? {
              page: {
                shown: products.items.length,
                nextCursor: products.nextCursor,
              },
            }
          : {})}
      />
      {state.view === 'kanban' ? (
        <KanbanView
          href={href}
          layout={groupOf ? 'columns' : 'grid'}
          columns={
            groupOf
              ? [...new Set(products.items.map(groupOf))].map((g) => ({
                  key: g,
                  title: g,
                  items: products.items.filter((p) => groupOf(p) === g),
                }))
              : [{ key: 'all', title: 'Products', items: products.items }]
          }
          title={(p) => p.name}
          card={(p) => (
            <>
              <span className="text-text-muted">
                {p.category ?? 'No category'} · {p.material}
                {p.hasModel && ' · 3D'}
              </span>
              <span className="flex justify-between">
                <Money amount={p.price} />
                {!p.active && <span className="text-text-muted">Hidden</span>}
              </span>
            </>
          )}
        />
      ) : (
        <ListView
          label="Products"
          rows={products.items}
          columns={COLUMNS}
          href={href}
          state={state}
          empty={
            mayAdd
              ? 'No products here. Add one with New product.'
              : 'No products here.'
          }
          group={groupOf ? { of: groupOf } : undefined}
        />
      )}
    </>
  );
}
