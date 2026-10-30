import type { AdminProductListItem, Page } from '@forgea/types';
import { Form, Link, useSearchParams } from 'react-router';
import { Money } from '~/components/money';
import { buttonClass } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { useCan } from '~/features/admin/access';
import { AdminHeader } from '~/features/admin/admin-ui';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ url, context }: Route.LoaderArgs) {
  const query = new URLSearchParams({
    limit: '50',
    sort: 'name',
    order: 'asc',
  });
  for (const key of ['q', 'cursor'] as const) {
    const value = url.searchParams.get(key);
    if (value) query.set(key, value);
  }
  const r = await context
    .get(apiContext)
    .get<Page<AdminProductListItem>>(`/products/manage?${query}`);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { products: r.data };
}

export default function Products({ loaderData }: Route.ComponentProps) {
  const { products } = loaderData;
  const [params] = useSearchParams();
  const mayAdd = useCan()('catalog.manage');
  const next = new URLSearchParams(params);
  if (products.nextCursor) next.set('cursor', products.nextCursor);
  return (
    <>
      <AdminHeader
        title="Products"
        intro="Everything in the shop. Prices come from the materials, the pricing settings and each product's options."
        action={
          mayAdd ? (
            <Link to="/admin/products/new" className={buttonClass()}>
              Add a product
            </Link>
          ) : undefined
        }
      />
      <Form method="get" role="search" className="mb-4 flex items-end gap-2">
        <Field
          label="Find a product"
          name="q"
          type="search"
          defaultValue={params.get('q') ?? ''}
        />
        <button type="submit" className={buttonClass('secondary')}>
          Search
        </button>
      </Form>
      {products.items.length === 0 ? (
        <p className="text-text-muted">
          No products yet.
          {mayAdd && (
            <>
              {' '}
              <Link to="/admin/products/new" className="underline">
                Add the first one
              </Link>
              .
            </>
          )}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Product
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Category
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Material
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  3D
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  From
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  In shop
                </th>
              </tr>
            </thead>
            <tbody>
              {products.items.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <Link
                      to={`/admin/products/${p.id}`}
                      className="font-semibold hover:underline"
                    >
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{p.category ?? '—'}</td>
                  <td className="px-4 py-3">{p.material}</td>
                  <td className="px-4 py-3">{p.hasModel ? 'Yes' : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <Money amount={p.price} />
                  </td>
                  <td className="px-4 py-3">
                    {p.active ? (
                      'Visible'
                    ) : (
                      <span className="text-text-muted">Hidden</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {products.hasMore && (
        <p className="mt-4">
          <Link to={`?${next}`} className={buttonClass('secondary')}>
            More products
          </Link>
        </p>
      )}
    </>
  );
}
