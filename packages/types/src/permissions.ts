import { Role } from './generated/prisma/enums.js';

/**
 * What a team member may see and do in the dashboard. The list is code (every API route names
 * the one it needs); which roles hold which is data the admin edits on "Roles & permissions",
 * with per-person grants and denials on top. Admins always hold everything, customers nothing.
 * Managing the team and these permissions is admin-only and never a permission, so nobody can
 * grant themselves (or an accomplice) more than they hold.
 */
export const PERMISSION_GROUPS = [
  {
    label: 'Orders and production',
    permissions: [
      { key: 'orders.view', label: 'See orders' },
      {
        key: 'orders.manage',
        label: 'Move orders through their statuses',
      },
      {
        key: 'production.manage',
        label: 'Plan and run print jobs (production)',
      },
    ],
  },
  {
    label: 'Custom requests',
    permissions: [
      { key: 'requests.view', label: 'See custom requests' },
      { key: 'requests.design', label: 'Send design previews' },
      {
        key: 'requests.quote',
        label: 'Quote a price and cancel requests',
        sensitive: true,
      },
    ],
  },
  {
    label: 'Sales',
    permissions: [
      { key: 'leads.view', label: 'See leads' },
      {
        key: 'leads.manage',
        label: 'Work leads: stages, follow-ups, notes',
      },
      {
        key: 'pipeline.manage',
        label: 'Edit the pipeline stages and lost reasons',
      },
      { key: 'quotations.view', label: 'See quotations' },
      {
        key: 'customers.view',
        label: 'See customers: with or without an account, and all they did',
      },
      {
        key: 'quotations.manage',
        label: 'Write, send, confirm and cancel quotations',
        sensitive: true,
      },
      {
        key: 'offers.manage',
        label: 'Run free offers (a free piece for a limited time)',
        sensitive: true,
      },
    ],
  },
  {
    label: 'Money',
    permissions: [
      { key: 'invoices.view', label: 'See invoices' },
      {
        key: 'invoices.create',
        label: 'Issue deposit and final invoices',
        sensitive: true,
      },
      {
        key: 'payments.record',
        label: 'Record payments received',
        sensitive: true,
      },
      {
        key: 'books.view',
        label: 'See the books and financial reports',
        sensitive: true,
      },
      {
        key: 'books.manage',
        label: 'Post journal entries, credit notes, accounts and tax',
        sensitive: true,
      },
      {
        key: 'pricing.manage',
        label: 'Change the pricing rules',
        sensitive: true,
      },
      {
        key: 'currencies.manage',
        label: 'Set exchange rates',
        sensitive: true,
      },
    ],
  },
  {
    label: 'Catalog',
    permissions: [
      { key: 'catalog.view', label: 'See the catalog in the dashboard' },
      {
        key: 'catalog.manage',
        label: 'Edit products, categories, options and 3D files',
      },
      { key: 'homebed.manage', label: 'Choose the home page bed' },
      { key: 'materials.view', label: 'See materials and stock' },
      {
        key: 'materials.manage',
        label: 'Change material prices and settings',
        sensitive: true,
      },
      {
        key: 'stock.manage',
        label: 'Record filament deliveries, use and counts; set restock limits',
      },
      {
        key: 'catalog.transfer',
        label: 'Import and export the whole catalog',
        sensitive: true,
      },
    ],
  },
  {
    label: 'Store',
    permissions: [
      { key: 'theme.manage', label: 'Change the shop colours' },
      {
        key: 'store.manage',
        label: 'Payment details, WhatsApp and request rules',
        sensitive: true,
      },
      {
        key: 'audit.view',
        label: 'Read the audit log',
        sensitive: true,
      },
    ],
  },
] as const satisfies readonly {
  label: string;
  permissions: readonly { key: string; label: string; sensitive?: true }[];
}[];

export type Permission =
  (typeof PERMISSION_GROUPS)[number]['permissions'][number]['key'];

export const PERMISSIONS: readonly Permission[] = PERMISSION_GROUPS.flatMap(
  (g) => g.permissions.map((p) => p.key),
);

const KNOWN = new Set<string>(PERMISSIONS);

export const isPermission = (value: string): value is Permission =>
  KNOWN.has(value);

/** The roles whose permissions an admin edits; admins hold everything, customers nothing. */
export const TEAM_ROLES_WITH_PERMISSIONS = [Role.STAFF, Role.DESIGNER] as const;
export type PermissionRole = (typeof TEAM_ROLES_WITH_PERMISSIONS)[number];

/** Each role's permissions until an admin changes them (the migration stores the same). */
export const DEFAULT_ROLE_PERMISSIONS: Record<
  PermissionRole,
  readonly Permission[]
> = {
  [Role.STAFF]: [
    'orders.view',
    'orders.manage',
    'production.manage',
    'requests.view',
    'requests.design',
    'requests.quote',
    'leads.view',
    'leads.manage',
    'quotations.view',
    'quotations.manage',
    'customers.view',
    'invoices.view',
    'invoices.create',
    'payments.record',
    'materials.view',
    'stock.manage',
  ],
  [Role.DESIGNER]: [
    'requests.view',
    'requests.design',
    'catalog.view',
    'catalog.manage',
    'homebed.manage',
    'materials.view',
  ],
};

/**
 * What a permission brings with it: its pages need that data too (managing something means
 * seeing it; planning production means seeing orders and materials). Added automatically, and
 * a denial of one of these takes the permission that needs it away as well.
 */
export const PERMISSION_INCLUDES: Partial<
  Record<Permission, readonly Permission[]>
> = {
  'orders.manage': ['orders.view'],
  'production.manage': ['orders.view', 'materials.view'],
  'requests.design': ['requests.view'],
  'requests.quote': ['requests.view'],
  'leads.manage': ['leads.view'],
  'pipeline.manage': ['leads.view'],
  'quotations.manage': ['quotations.view'],
  'offers.manage': ['catalog.view'],
  'invoices.create': ['invoices.view'],
  'payments.record': ['invoices.view'],
  'books.manage': ['books.view'],
  'catalog.manage': ['catalog.view', 'materials.view'],
  'homebed.manage': ['catalog.view'],
  'materials.manage': ['materials.view'],
  'stock.manage': ['materials.view'],
};

/**
 * What someone may do: their role's permissions, plus what was granted to them (each with what
 * it includes), minus what was denied; a denial always wins, also over a permission needing
 * the denied one. Unknown keys (a renamed permission) are dropped, so they never grant
 * anything. The API and the access page's preview both use this.
 */
export function effectivePermissions(
  role: Role,
  rolePermissions: readonly string[],
  granted: readonly string[],
  denied: readonly string[],
): Permission[] {
  if (role === Role.ADMIN) return [...PERMISSIONS];
  if (role === Role.CUSTOMER) return [];
  const no = new Set(denied);
  const yes = new Set(
    [...rolePermissions, ...granted]
      .filter(isPermission)
      .flatMap((p) => [p, ...(PERMISSION_INCLUDES[p] ?? [])]),
  );
  return PERMISSIONS.filter(
    (p) =>
      yes.has(p) &&
      !no.has(p) &&
      (PERMISSION_INCLUDES[p] ?? []).every((needed) => !no.has(needed)),
  );
}
