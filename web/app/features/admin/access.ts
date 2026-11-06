import {
  type Permission,
  PERMISSION_GROUPS,
  PERMISSION_INCLUDES,
  type Profile,
  Role,
} from '@forgea/types';
import { useRouteLoaderData } from 'react-router';
import type { loader as adminLoader } from '~/routes/admin/route';

/** A permission, 'team' for any team member, or 'admin' for admins only. */
type PageAccess = Permission | 'team' | 'admin';

/**
 * Who may open each dashboard page. `staffMiddleware` refuses the rest before any loader runs,
 * and the menu shows only these, so a page someone may not open is neither listed nor
 * reachable by typing its address. The longest matching path wins; a dashboard address not
 * listed here is admin-only, so a new page stays closed until someone adds it.
 */
/** The dashboard menu's groups, like apps: each opens to its pages. */
export const MENU_GROUPS = [
  'Sales',
  'Orders',
  'Accounting',
  'Catalog',
  'Settings',
] as const;
export type MenuGroup = (typeof MENU_GROUPS)[number];

export const PAGES: readonly {
  path: string;
  access: PageAccess;
  /** Shown in the dashboard menu, under its group, in this order. */
  label?: string;
  group?: MenuGroup;
  /** Listed under the group's Configuration heading (the records the rest are built from). */
  config?: true;
}[] = [
  { path: '/admin', access: 'team', label: 'Overview' },
  {
    path: '/admin/todo',
    access: 'leads.view',
    label: 'To-do',
    group: 'Sales',
  },
  {
    path: '/admin/leads',
    access: 'leads.view',
    label: 'Leads',
    group: 'Sales',
  },
  { path: '/admin/leads/new', access: 'leads.manage' },
  {
    path: '/admin/quotations',
    access: 'quotations.view',
    label: 'Quotations',
    group: 'Sales',
  },
  { path: '/admin/quotations/new', access: 'quotations.manage' },
  {
    path: '/admin/customers',
    access: 'customers.view',
    label: 'Customers',
    group: 'Sales',
  },
  // The old address of the stages page: it now leads to Lead stages.
  { path: '/admin/pipeline', access: 'pipeline.manage' },
  {
    path: '/admin/lead-stages',
    access: 'pipeline.manage',
    label: 'Lead stages',
    group: 'Sales',
    config: true,
  },
  {
    path: '/admin/lost-reasons',
    access: 'pipeline.manage',
    label: 'Lost reasons',
    group: 'Sales',
    config: true,
  },
  {
    path: '/admin/orders',
    access: 'orders.view',
    label: 'Orders',
    group: 'Orders',
  },
  {
    path: '/admin/production',
    access: 'production.manage',
    label: 'Production',
    group: 'Orders',
  },
  {
    path: '/admin/production/results',
    access: 'production.manage',
    label: 'Production results',
    group: 'Orders',
  },
  {
    path: '/admin/printers',
    access: 'production.manage',
    label: 'Printers',
    group: 'Orders',
    config: true,
  },
  {
    path: '/admin/requests',
    access: 'requests.view',
    label: 'Custom requests',
    group: 'Orders',
  },
  {
    path: '/admin/insights',
    access: 'books.view',
    label: 'Business',
    group: 'Accounting',
  },
  {
    path: '/admin/accounting',
    access: 'invoices.view',
    label: 'Invoices',
    group: 'Accounting',
  },
  {
    path: '/admin/accounting/books',
    access: 'books.view',
    label: 'Books',
    group: 'Accounting',
  },
  { path: '/admin/accounting/books/entries/new', access: 'books.manage' },
  {
    path: '/admin/accounting/reports',
    access: 'books.view',
    label: 'Reports',
    group: 'Accounting',
  },
  {
    path: '/admin/products',
    access: 'catalog.view',
    label: 'Products',
    group: 'Catalog',
  },
  {
    path: '/admin/fonts',
    access: 'catalog.view',
    label: 'Fonts',
    group: 'Catalog',
    config: true,
  },
  { path: '/admin/fonts/new', access: 'catalog.manage' },
  { path: '/admin/products/new', access: 'catalog.manage' },
  {
    path: '/admin/categories',
    access: 'catalog.view',
    label: 'Categories',
    group: 'Catalog',
    config: true,
  },
  { path: '/admin/categories/new', access: 'catalog.manage' },
  {
    path: '/admin/options',
    access: 'catalog.view',
    label: 'Options',
    group: 'Catalog',
    config: true,
  },
  { path: '/admin/options/new', access: 'catalog.manage' },
  {
    path: '/admin/materials',
    access: 'materials.view',
    label: 'Materials',
    group: 'Catalog',
    config: true,
  },
  { path: '/admin/materials/new', access: 'materials.manage' },
  {
    path: '/admin/stock',
    access: 'materials.view',
    label: 'Filament stock',
    group: 'Catalog',
  },
  // Recording a movement: every API call behind these pages needs stock.manage.
  {
    path: '/admin/stock/pieces',
    access: 'materials.view',
    label: 'Ready pieces',
    group: 'Catalog',
  },
  { path: '/admin/stock/receive', access: 'stock.manage' },
  { path: '/admin/stock/print', access: 'stock.manage' },
  { path: '/admin/stock/failed', access: 'stock.manage' },
  { path: '/admin/stock/weigh', access: 'stock.manage' },
  {
    path: '/admin/home-plate',
    access: 'homebed.manage',
    label: 'Home page bed',
    group: 'Catalog',
  },
  {
    path: '/admin/catalog',
    access: 'catalog.transfer',
    label: 'Import & export',
    group: 'Catalog',
  },
  { path: '/admin/catalog-export', access: 'catalog.transfer' },
  {
    path: '/admin/pricing',
    access: 'pricing.manage',
    label: 'Pricing',
    group: 'Settings',
  },
  {
    path: '/admin/currencies',
    access: 'currencies.manage',
    label: 'Exchange rates',
    group: 'Accounting',
    config: true,
  },
  {
    path: '/admin/settings',
    access: 'store.manage',
    label: 'Payment, requests & emails',
    group: 'Settings',
  },
  {
    path: '/admin/theme',
    access: 'theme.manage',
    label: 'Theme',
    group: 'Settings',
  },
  { path: '/admin/team', access: 'admin', label: 'Team', group: 'Settings' },
  {
    path: '/admin/backups',
    access: 'admin',
    label: 'Backups',
    group: 'Settings',
  },
  { path: '/admin/team/new', access: 'admin' },
  {
    path: '/admin/permissions',
    access: 'admin',
    label: 'Roles & permissions',
    group: 'Settings',
  },
  {
    path: '/admin/audit',
    access: 'audit.view',
    label: 'Audit log',
    group: 'Settings',
  },
];

const within = (pathname: string, path: string) =>
  pathname === path || pathname.startsWith(`${path}/`);

/** The rule for a dashboard address (admin-only when no page matches). */
export function pageAccess(pathname: string): PageAccess {
  const path = pathname.replace(/\/+$/, '') || '/';
  let best: (typeof PAGES)[number] | undefined;
  for (const page of PAGES) {
    if (
      within(path, page.path) &&
      (!best || page.path.length > best.path.length)
    )
      best = page;
  }
  // "/admin" itself matches every address; only the overview may use it.
  if (!best || (best.path === '/admin' && path !== '/admin')) return 'admin';
  return best.access;
}

/** Whether this team member holds a permission (admins hold all of them). */
export const can = (staff: Profile, permission: Permission): boolean =>
  staff.role === Role.ADMIN || staff.permissions.includes(permission);

export function mayOpen(staff: Profile, access: PageAccess): boolean {
  if (staff.role === Role.CUSTOMER) return false;
  if (staff.role === Role.ADMIN || access === 'team') return true;
  return access !== 'admin' && staff.permissions.includes(access);
}

/**
 * For dashboard components: `const can = useCan(); can('orders.manage') && <button…>`.
 * Hides what someone may not do; the API refuses it anyway.
 */
export function useCan(): (permission: Permission) => boolean {
  const data = useRouteLoaderData<typeof adminLoader>('routes/admin');
  return (permission) => (data ? can(data.staff, permission) : false);
}

const LABELS = new Map<string, string>(
  PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => [p.key, p.label])),
);

/** "Also: see orders, see materials and stock", for permissions that bring others along. */
export function includesText(permission: Permission): string | null {
  const more = PERMISSION_INCLUDES[permission];
  return more?.length
    ? `Also: ${more.map((p) => (LABELS.get(p) ?? p).toLowerCase()).join(', ')}`
    : null;
}
