import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Profile, PERMISSIONS, Role } from '@forgea/types';
import { describe, expect, it } from 'vitest';
import { can, mayOpen, PAGES, pageAccess } from './access';

const person = (
  role: Role,
  permissions: Profile['permissions'] = [],
): Profile => ({
  id: 'u',
  email: 'u@example.com',
  name: null,
  phone: null,
  role,
  emailVerified: true,
  hasPassword: false,
  permissions,
});

describe('pageAccess', () => {
  it('uses the longest matching page', () => {
    expect(pageAccess('/admin/products')).toBe('catalog.view');
    expect(pageAccess('/admin/products/0190')).toBe('catalog.view');
    expect(pageAccess('/admin/products/new')).toBe('catalog.manage');
    expect(pageAccess('/admin/accounting')).toBe('invoices.view');
    expect(pageAccess('/admin/accounting/books')).toBe('books.view');
    expect(pageAccess('/admin/catalog-export')).toBe('catalog.transfer');
  });

  it('keeps unknown dashboard addresses for admins, never "any team member"', () => {
    expect(pageAccess('/admin')).toBe('team');
    expect(pageAccess('/admin/')).toBe('team');
    expect(pageAccess('/admin/something-new')).toBe('admin');
    expect(pageAccess('/admin/orders-export')).toBe('admin');
    expect(pageAccess('/admin/team')).toBe('admin');
  });

  it('has a rule for every dashboard page, and admin-only ones are on purpose', () => {
    const routes = fileURLToPath(new URL('../../routes', import.meta.url));
    const adminOnly: string[] = [];
    for (const folder of readdirSync(routes)) {
      if (!folder.startsWith('admin.')) continue;
      const path = `/${folder
        .split('.')
        .filter((s) => s !== '_index')
        // "$id" is any id; "team_" (out of the team page's layout) is still /team.
        .map((s) => (s.startsWith('$') ? 'some-id' : s.replace(/_$/, '')))
        .join('/')}`;
      if (pageAccess(path) === 'admin') adminOnly.push(path);
    }
    expect(adminOnly.sort()).toEqual([
      '/admin/permissions',
      '/admin/team',
      '/admin/team/some-id',
    ]);
  });

  it('names only real permissions', () => {
    for (const p of PAGES) {
      expect(['team', 'admin', ...PERMISSIONS].includes(p.access)).toBe(true);
    }
  });
});

describe('who may open what', () => {
  it('admins open everything; customers nothing', () => {
    for (const p of PAGES) {
      expect(mayOpen(person(Role.ADMIN), p.access)).toBe(true);
      expect(mayOpen(person(Role.CUSTOMER, [...PERMISSIONS]), p.access)).toBe(
        false,
      );
    }
  });

  it('team members open the overview and pages their permissions cover, never admin pages', () => {
    const staff = person(Role.STAFF, [...PERMISSIONS]);
    expect(mayOpen(person(Role.DESIGNER), 'team')).toBe(true);
    expect(mayOpen(person(Role.DESIGNER), 'orders.view')).toBe(false);
    expect(mayOpen(person(Role.STAFF, ['orders.view']), 'orders.view')).toBe(
      true,
    );
    expect(mayOpen(staff, 'admin')).toBe(false);
    expect(can(staff, 'books.manage')).toBe(true);
    expect(can(person(Role.STAFF), 'books.manage')).toBe(false);
    expect(can(person(Role.ADMIN), 'books.manage')).toBe(true);
  });
});
