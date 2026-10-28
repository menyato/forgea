import type { AdminProductListItem, MaterialView, Page } from '@forgea/types';
import { Link } from 'react-router';
import { buttonClass } from '~/components/ui/button';
import { AdminHeader, Panel } from '~/features/admin/admin-ui';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const [products, materials] = await Promise.all([
    api.get<Page<AdminProductListItem>>('/products/manage?limit=100'),
    api.get<MaterialView[]>('/materials'),
  ]);
  const items = products.ok ? products.data.items : [];
  return {
    products: items.length,
    visible: items.filter((p) => p.active).length,
    without3d: items.filter((p) => !p.hasModel).length,
    lowStock: materials.ok
      ? materials.data.filter(
          (m) => m.active && m.stockGrams <= m.lowStockThresholdGrams,
        )
      : [],
  };
}

export default function Overview({ loaderData }: Route.ComponentProps) {
  const { products, visible, without3d, lowStock } = loaderData;
  return (
    <>
      <AdminHeader
        title="Overview"
        intro="Your catalog at a glance. Everything customers see — products, categories, options and their prices — is set up from these pages."
        action={
          <Link to="/admin/products/new" className={buttonClass()}>
            Add a product
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Panel>
          <p className="text-3xl font-bold">{products}</p>
          <p className="text-sm text-text-muted">
            products, {visible} visible in the shop
          </p>
        </Panel>
        <Panel>
          <p className="text-3xl font-bold">{without3d}</p>
          <p className="text-sm text-text-muted">
            without a 3D model —{' '}
            <Link to="/admin/products" className="underline">
              add one
            </Link>{' '}
            for the 3D view
          </p>
        </Panel>
        <Panel>
          <p className="text-3xl font-bold">{lowStock.length}</p>
          <p className="text-sm text-text-muted">
            materials low on stock
            {lowStock.length > 0 &&
              `: ${lowStock.map((m) => m.code).join(', ')}`}
          </p>
        </Panel>
      </div>
      <Panel title="Setting up a product" className="mt-6">
        <ol className="grid list-decimal gap-2 pl-5 text-sm">
          <li>
            <Link to="/admin/materials" className="underline">
              Materials
            </Link>
            : what each costs per gram, its density and print speed.
          </li>
          <li>
            <Link to="/admin/options" className="underline">
              Options
            </Link>
            : colours, sizes, a name to print — and what each does to the price.
          </li>
          <li>
            <Link to="/admin/categories" className="underline">
              Categories
            </Link>
            : the sections of the shop.
          </li>
          <li>
            <Link to="/admin/products/new" className="underline">
              Products
            </Link>
            : upload the STL or GLB, check it in 3D, use the suggested grams and
            hours, pick the options.
          </li>
        </ol>
      </Panel>
    </>
  );
}
