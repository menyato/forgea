import { Role } from '@forgea/types';
import { NavLink, Outlet } from 'react-router';
import { PAGE_WIDTH } from '~/components/layout/page-width';
import { staffContext, staffMiddleware } from '~/features/admin/staff.server';
import type { Route } from './+types/route';

export const middleware: Route.MiddlewareFunction[] = [staffMiddleware];

export function meta(_: Route.MetaArgs) {
  return [
    { title: 'Dashboard — Forgea' },
    // Private pages: keep them out of search engines.
    { name: 'robots', content: 'noindex' },
  ];
}

export function loader({ context }: Route.LoaderArgs) {
  return { staff: context.get(staffContext) };
}

const TEAM = [Role.STAFF, Role.DESIGNER] as const;
/** Each section and who may open it; admins see everything (the API enforces the same). */
const SECTIONS: readonly {
  to: string;
  label: string;
  roles: readonly Role[];
  end?: true;
}[] = [
  { to: '/admin', label: 'Overview', roles: TEAM, end: true },
  { to: '/admin/orders', label: 'Orders', roles: [Role.STAFF] },
  { to: '/admin/production', label: 'Production', roles: [Role.STAFF] },
  { to: '/admin/requests', label: 'Custom requests', roles: TEAM },
  { to: '/admin/leads', label: 'Leads', roles: [Role.STAFF] },
  { to: '/admin/quotations', label: 'Quotations', roles: [Role.STAFF] },
  { to: '/admin/accounting', label: 'Invoices', roles: [Role.STAFF] },
  { to: '/admin/products', label: 'Products', roles: [Role.DESIGNER] },
  { to: '/admin/home-plate', label: 'Home page bed', roles: [Role.DESIGNER] },
  { to: '/admin/categories', label: 'Categories', roles: [Role.DESIGNER] },
  { to: '/admin/options', label: 'Options', roles: [Role.DESIGNER] },
  { to: '/admin/materials', label: 'Materials', roles: [] },
  { to: '/admin/pipeline', label: 'Sales pipeline', roles: [] },
  { to: '/admin/pricing', label: 'Pricing', roles: [] },
  { to: '/admin/currencies', label: 'Exchange rates', roles: [] },
  { to: '/admin/theme', label: 'Theme', roles: [] },
  { to: '/admin/team', label: 'Team', roles: [] },
  { to: '/admin/catalog', label: 'Import & export', roles: [] },
  { to: '/admin/audit', label: 'Audit log', roles: [] },
  { to: '/admin/settings', label: 'Payment & requests', roles: [] },
];

/** The dashboard frame: section navigation beside the page. */
export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  return (
    <div className={`${PAGE_WIDTH} grid gap-8 py-8 md:grid-cols-[13rem_1fr]`}>
      <aside className="grid content-start gap-4">
        <div>
          <p className="font-display text-lg font-bold">Dashboard</p>
          <p className="text-sm text-text-muted">
            {loaderData.staff.name ?? loaderData.staff.email}
          </p>
        </div>
        <nav aria-label="Dashboard">
          <ul className="flex flex-wrap gap-1 md:grid">
            {SECTIONS.filter(
              (s) =>
                loaderData.staff.role === Role.ADMIN ||
                s.roles.includes(loaderData.staff.role),
            ).map((s) => (
              <li key={s.to}>
                <NavLink
                  to={s.to}
                  end={s.end}
                  className={({ isActive }) =>
                    `block rounded-md px-3 py-2 text-sm ${
                      isActive
                        ? 'bg-accent text-on-accent font-semibold'
                        : 'text-text-muted hover:bg-surface hover:text-text'
                    }`
                  }
                >
                  {s.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
