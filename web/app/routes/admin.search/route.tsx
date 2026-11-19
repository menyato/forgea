import type {
  AdminProductListItem,
  CustomerList,
  CustomRequestListItem,
  LeadListItem,
  OrderListItem,
  Page,
  QuotationListItem,
} from '@forgea/types';
import { Link } from 'react-router';
import { can } from '~/features/admin/access';
import { AdminHeader, Panel } from '~/features/admin/admin-ui';
import { SearchBox } from '~/features/admin/search-box';
import { staffContext } from '~/features/admin/staff.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** How many of each kind the search shows; the list it opens has the rest. */
const SHOWN = 5;

interface Hit {
  to: string;
  title: string;
  detail: string;
}

/**
 * One search over the records the studio works with: orders, customers, products,
 * quotations, leads and custom requests, each from its own list (what this person may see),
 * a few of each, with a link to the full list searched the same way.
 */
export async function loader({ url, context }: Route.LoaderArgs) {
  const q = url.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return { q, groups: [] };
  const api = context.get(apiContext);
  const staff = context.get(staffContext);
  const query = new URLSearchParams({ q, limit: String(SHOWN) });
  const ask = <T,>(path: string) =>
    api.get<T>(`${path}?${query}`).then((r) => (r.ok ? r.data : null));
  const [orders, customers, products, quotations, leads, requests] =
    await Promise.all([
      can(staff, 'orders.view') ? ask<Page<OrderListItem>>('/orders') : null,
      can(staff, 'customers.view') ? ask<CustomerList>('/customers') : null,
      can(staff, 'catalog.view')
        ? ask<Page<AdminProductListItem>>('/products/manage')
        : null,
      can(staff, 'quotations.view')
        ? ask<Page<QuotationListItem>>('/quotations')
        : null,
      can(staff, 'leads.view') ? ask<Page<LeadListItem>>('/leads') : null,
      can(staff, 'requests.view')
        ? ask<Page<CustomRequestListItem>>('/custom-requests')
        : null,
    ]);
  const find = encodeURIComponent(q);
  const groups: { label: string; all: string; hits: Hit[] }[] = [];
  const add = (label: string, all: string, hits: Hit[] | undefined) => {
    if (hits?.length) groups.push({ label, all, hits: hits.slice(0, SHOWN) });
  };
  add(
    'Orders',
    `/admin/orders?filter=&q=${find}`,
    orders?.items.map((o) => ({
      to: `/admin/orders/${o.id}`,
      title: `${o.orderNumber} · ${o.customerName}`,
      detail: o.customerEmail,
    })),
  );
  add(
    'Customers',
    `/admin/customers?q=${find}`,
    customers?.items.map((c) => ({
      to: `/admin/customers/${encodeURIComponent(c.email)}`,
      title: c.name ?? c.email,
      detail: [c.email, c.phone].filter(Boolean).join(' · '),
    })),
  );
  add(
    'Products',
    `/admin/products?q=${find}`,
    products?.items.map((p) => ({
      to: `/admin/products/${p.id}`,
      title: p.name,
      detail: `${p.material}${p.active ? '' : ' · not in the shop'}`,
    })),
  );
  add(
    'Quotations',
    `/admin/quotations?q=${find}`,
    quotations?.items.map((x) => ({
      to: `/admin/quotations/${x.id}`,
      title: `${x.number} · ${x.customer.name ?? x.customer.email}`,
      detail: x.orderNumber ? `order ${x.orderNumber}` : x.status.toLowerCase(),
    })),
  );
  add(
    'Leads',
    `/admin/leads?view=list&filter=&q=${find}`,
    leads?.items.map((l) => ({
      to: `/admin/leads/${l.id}`,
      title: l.name,
      detail: `${l.email} · ${l.stage.name}`,
    })),
  );
  add(
    'Custom requests',
    `/admin/requests?filter=&q=${find}`,
    requests?.items.map((r) => ({
      to: `/admin/requests/${r.id}`,
      title: `${r.requestNumber} · ${r.title}`,
      detail: r.customerEmail,
    })),
  );
  return { q, groups };
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const { q, groups } = loaderData;
  return (
    <>
      <AdminHeader
        title="Search"
        intro="Orders, customers, products, quotations, leads and custom requests at once: an order number, a name, an email, a phone or a product."
      />
      <SearchBox defaultValue={q} className="mb-6 max-w-xl" />
      {q.length >= 2 && groups.length === 0 && (
        <p className="text-text-muted">Nothing matches “{q}”.</p>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        {groups.map((g) => (
          <Panel key={g.label} title={g.label}>
            <ul className="grid gap-2">
              {g.hits.map((h) => (
                <li key={h.to}>
                  <Link
                    to={h.to}
                    className="grid rounded-md px-2 py-1 hover:bg-surface-raised"
                  >
                    <span className="font-medium">{h.title}</span>
                    <span className="text-sm text-text-muted">{h.detail}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link to={g.all} className="text-sm underline underline-offset-4">
              All {g.label.toLowerCase()} matching “{q}”
            </Link>
          </Panel>
        ))}
      </div>
    </>
  );
}
