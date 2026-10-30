import { describe, expect, it } from 'vitest';
import { Role } from './generated/prisma/enums.js';
import {
  DEFAULT_ROLE_PERMISSIONS,
  effectivePermissions,
  isPermission,
  PERMISSION_GROUPS,
  PERMISSION_INCLUDES,
  PERMISSIONS,
} from './permissions.js';

describe('effectivePermissions', () => {
  it('gives admins everything and customers nothing, whatever is stored', () => {
    expect(effectivePermissions(Role.ADMIN, [], [], [...PERMISSIONS])).toEqual(
      PERMISSIONS,
    );
    expect(
      effectivePermissions(
        Role.CUSTOMER,
        [...PERMISSIONS],
        [...PERMISSIONS],
        [],
      ),
    ).toEqual([]);
  });

  it('is the role, plus grants, minus denials; a denial beats both', () => {
    expect(
      effectivePermissions(
        Role.STAFF,
        ['orders.view', 'orders.manage'],
        ['books.view', 'orders.manage'],
        ['orders.manage'],
      ),
    ).toEqual(['orders.view', 'books.view']);
  });

  it('drops unknown keys, so a renamed permission never grants anything', () => {
    expect(
      effectivePermissions(
        Role.DESIGNER,
        ['everything', '*'],
        ['team.manage'],
        [],
      ),
    ).toEqual([]);
  });
});

describe('what a permission includes', () => {
  it('adds what a page needs, so planning production also shows orders and materials', () => {
    expect(
      effectivePermissions(Role.STAFF, [], ['production.manage'], []),
    ).toEqual(['orders.view', 'production.manage', 'materials.view']);
  });

  it('denying what a permission needs takes that permission away too', () => {
    expect(
      effectivePermissions(
        Role.DESIGNER,
        ['catalog.manage'],
        [],
        ['materials.view'],
      ),
    ).toEqual(['catalog.view']);
  });

  it('only includes real permissions, one level deep', () => {
    for (const [p, needs] of Object.entries(PERMISSION_INCLUDES)) {
      expect(isPermission(p)).toBe(true);
      for (const n of needs) {
        expect(isPermission(n)).toBe(true);
        // Kept flat, so one look at the list says everything a permission brings.
        expect(PERMISSION_INCLUDES[n]).toBeUndefined();
      }
    }
  });
});

describe('the permission list', () => {
  it('has unique keys, and every default is a real permission', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    for (const keys of Object.values(DEFAULT_ROLE_PERMISSIONS)) {
      expect(keys.every(isPermission)).toBe(true);
    }
    expect(PERMISSION_GROUPS.every((g) => g.permissions.length > 0)).toBe(true);
  });

  it('never lists managing the team or permissions: that stays with admins', () => {
    expect(PERMISSIONS.some((p) => p.startsWith('team.'))).toBe(false);
    expect(isPermission('team.manage')).toBe(false);
  });
});
