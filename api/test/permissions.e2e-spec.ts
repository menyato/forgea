import { randomUUID } from 'node:crypto';
import {
  DEFAULT_ROLE_PERMISSIONS,
  type Permission,
  PERMISSION_INCLUDES,
  PERMISSIONS,
} from '@forgea/types';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ConfigService } from '@nestjs/config';
import { ModulesContainer } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ACCESS, IS_PUBLIC } from '../src/authorization/decorators.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import { CSRF, createProduct, signedInAs } from './commerce-helpers.js';
import { createApp } from './create-app.js';

interface Route {
  method: string;
  path: string;
  access: string | undefined;
  isPublic: boolean;
}

/**
 * Signed-in routes that need no permission: a customer's own account, cart, orders and
 * requests (their services check ownership). Anything new that is neither public nor in this
 * list fails the first test: a dashboard route must say which permission it needs.
 */
const CUSTOMER_ROUTES = [
  'GET /auth/me',
  'PATCH /auth/me',
  'POST /auth/password/change',
  'POST /orders/checkout',
  'GET /orders/mine',
  'POST /orders/mine/:number/cancel',
  'POST /orders/mine/:number/reorder',
  'GET /custom-requests/mine',
  'GET /custom-requests/mine/:number',
  'POST /custom-requests',
  'POST /custom-requests/estimate',
  'POST /custom-requests/files',
  'POST /custom-requests/mine/:number/accept',
  'POST /custom-requests/mine/:number/cancel',
  'POST /custom-requests/mine/:number/decline',
  'GET /quotations/mine/:number',
  'POST /quotations/mine/:number/accept',
  'POST /quotations/mine/:number/decline',
  'POST /quotations/link/:token/accept',
];

/** Every route of the running app, with what it needs (read the way Nest's router does). */
function routesOf(app: NestExpressApplication): Route[] {
  const routes: Route[] = [];
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const type = wrapper.metatype as (new () => object) | null;
      if (!type) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, type) ?? '');
      for (const name of Object.getOwnPropertyNames(type.prototype)) {
        const handler: unknown = type.prototype[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const method: RequestMethod | undefined = Reflect.getMetadata(
          METHOD_METADATA,
          handler,
        );
        const sub: unknown = Reflect.getMetadata(PATH_METADATA, handler);
        if (method === undefined || typeof sub !== 'string') continue;
        const read = <T>(key: string): T | undefined =>
          Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, type);
        routes.push({
          method: RequestMethod[method],
          path: `/${[base, sub].filter((p) => p && p !== '/').join('/')}`.replace(
            /\/+/g,
            '/',
          ),
          access: read<string>(ACCESS),
          isPublic: read<boolean>(IS_PUBLIC) === true,
        });
      }
    }
  }
  return routes;
}

/** A concrete URL for a route pattern: any id is a random UUID, a role a real role. */
const urlOf = (path: string) =>
  path.replace(/:(\w+)/g, (_, name: string) =>
    name === 'role'
      ? Role.STAFF
      : name === 'code'
        ? 'EUR'
        : name === 'number' || name === 'slug'
          ? 'NOPE-1'
          : randomUUID(),
  );

describe('Team permissions (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let proxySecret: string;
  let ip = 0;
  /** Each request from its own address, so checking every route never hits the rate limit. */
  const http = (method: string, url: string, cookie: string) => {
    ip += 1;
    return request(app.getHttpServer())
      [method.toLowerCase() as 'get'](url)
      .set(CSRF)
      .set('x-forgea-proxy-secret', proxySecret)
      .set('x-forgea-client-ip', `10.77.${(ip >> 8) & 255}.${ip & 255}`)
      .set('Cookie', cookie);
  };
  const as = (cookie: string) => ({
    get: (url: string) => http('GET', url, cookie),
    put: (url: string, body: object) => http('PUT', url, cookie).send(body),
    post: (url: string, body: object) => http('POST', url, cookie).send(body),
  });

  /** A staff member whose own grants and denials are exactly these. */
  async function staffWith(granted: string[], denied: string[] = []) {
    const s = await signedInAs(app, Role.STAFF);
    await prisma.user.update({
      where: { id: s.user.id },
      data: { grantedPermissions: granted, deniedPermissions: denied },
    });
    return s;
  }

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    proxySecret = app.get(ConfigService).getOrThrow('INTERNAL_PROXY_SECRET');
  });
  afterAll(async () => {
    // Put the roles back as the migration left them, whatever a failed test changed.
    for (const [role, permissions] of Object.entries(
      DEFAULT_ROLE_PERMISSIONS,
    )) {
      await prisma.rolePermissions.update({
        where: { role: role as Role },
        data: { permissions: [...permissions] },
      });
    }
    await app.close();
  });

  describe('every route', () => {
    it('is public, a customer route, or names its permission', () => {
      const routes = routesOf(app);
      expect(routes.length).toBeGreaterThan(100);
      const unmarked = routes
        .filter((r) => !r.isPublic && !r.access)
        .map((r) => `${r.method} ${r.path}`)
        .sort();
      expect(unmarked).toEqual([...CUSTOMER_ROUTES].sort());
      // Every permission a route names is a real one, and every permission guards something.
      const named = new Set(routes.map((r) => r.access).filter(Boolean));
      for (const p of named) {
        expect(
          p === 'admin' || (PERMISSIONS as readonly string[]).includes(p!),
        ).toBe(true);
      }
      for (const p of PERMISSIONS) expect(named.has(p)).toBe(true);
    });

    it('refuses customers and staff without the permission; lets the permission in', async () => {
      const protectedRoutes = routesOf(app).filter(
        (r) => r.access && !r.isPublic,
      );
      const customer = await signedInAs(app, Role.CUSTOMER);
      // Holds every permission, except the one being checked.
      const everything = [...PERMISSIONS];
      const problems: string[] = [];
      for (const r of protectedRoutes) {
        const url = urlOf(r.path);
        const label = `${r.method} ${r.path} (${r.access})`;
        const send = async (cookie: string) =>
          (await http(r.method, url, cookie).send({})).status;

        if ((await send(customer.cookie)) !== 403)
          problems.push(`${label}: a customer was not refused`);

        if (r.access === 'admin') {
          const allOfThem = await staffWith(everything);
          if ((await send(allOfThem.cookie)) !== 403)
            problems.push(`${label}: staff with every permission got in`);
          continue;
        }
        const without = await staffWith(
          everything.filter((p) => p !== r.access),
          [r.access!],
        );
        if ((await send(without.cookie)) !== 403)
          problems.push(`${label}: staff without it were not refused`);

        // With only this permission (and what it includes) the guard lets them through (the
        // route may still say 400 or 404 for the made-up ids and empty body, never 401 or 403).
        const keep = [
          r.access!,
          ...(PERMISSION_INCLUDES[r.access as Permission] ?? []),
        ];
        const only = await staffWith(
          [r.access!],
          DEFAULT_ROLE_PERMISSIONS[Role.STAFF].filter((p) => !keep.includes(p)),
        );
        const status = await send(only.cookie);
        if (status === 401 || status === 403)
          problems.push(
            `${label}: staff with only this permission got ${status}`,
          );
      }
      expect(problems).toEqual([]);
    });
  });

  describe('changes apply on the next request, with the same sign-in', () => {
    it('a role losing a permission loses it for everyone with that role at once', async () => {
      const admin = await signedInAs(app, Role.ADMIN);
      const staff = await signedInAs(app, Role.STAFF);
      await as(staff.cookie).get('/orders').expect(200);

      // Seeing orders, and everything that includes it (managing them, production).
      const without = DEFAULT_ROLE_PERMISSIONS[Role.STAFF].filter(
        (p) =>
          p !== 'orders.view' &&
          !(PERMISSION_INCLUDES[p] ?? []).includes('orders.view'),
      );
      await as(admin.cookie)
        .put('/permissions/roles/STAFF', { permissions: without })
        .expect(200);
      await as(staff.cookie).get('/orders').expect(403);
      const me = (await as(staff.cookie).get('/auth/me').expect(200)).body;
      expect(me.permissions).not.toContain('orders.view');

      await as(admin.cookie)
        .put('/permissions/roles/STAFF', {
          permissions: [...DEFAULT_ROLE_PERMISSIONS[Role.STAFF]],
        })
        .expect(200);
      await as(staff.cookie).get('/orders').expect(200);
      await prisma.auditLog.findFirstOrThrow({
        where: {
          actorUserId: admin.user.id,
          action: 'role.permissions.update',
          targetId: 'STAFF',
        },
      });
    });

    it('a denial beats the role, a grant adds to it; both show in /auth/me', async () => {
      const admin = await signedInAs(app, Role.ADMIN);
      const staff = await signedInAs(app, Role.STAFF);
      await as(staff.cookie).get('/accounting/entries').expect(403);

      const saved = await as(admin.cookie)
        .put(`/users/${staff.user.id}/access`, {
          granted: ['books.view'],
          denied: ['orders.view'],
        })
        .expect(200);
      expect(saved.body.permissions).toContain('books.view');
      expect(saved.body.permissions).not.toContain('orders.view');

      await as(staff.cookie).get('/accounting/entries').expect(200);
      await as(staff.cookie).get('/orders').expect(403);
      // Seeing the books is not changing them.
      await as(staff.cookie).post('/accounting/accounts', {}).expect(403);
      const me = (await as(staff.cookie).get('/auth/me').expect(200)).body;
      expect(me.permissions).toEqual(saved.body.permissions);
      await prisma.auditLog.findFirstOrThrow({
        where: {
          actorUserId: admin.user.id,
          action: 'user.access.update',
          targetId: staff.user.id,
        },
      });
    });

    it('switching someone off closes everything at once, though their token is still valid', async () => {
      const admin = await signedInAs(app, Role.ADMIN);
      const staff = await signedInAs(app, Role.STAFF);
      await prisma.user.update({
        where: { id: staff.user.id },
        data: { googleId: `g-${staff.user.id}` },
      });
      await as(staff.cookie).get('/orders').expect(200);
      await as(admin.cookie)
        .put(`/users/${staff.user.id}/team`, {
          role: Role.STAFF,
          active: false,
        })
        .expect(200);
      await as(staff.cookie).get('/orders').expect(403);
    });

    it('a demoted admin loses admin pages at once; the old token claiming ADMIN does not help', async () => {
      const admin = await signedInAs(app, Role.ADMIN);
      const demoted = await signedInAs(app, Role.ADMIN);
      await as(demoted.cookie).get('/audit-log').expect(200);
      await as(admin.cookie)
        .put(`/users/${demoted.user.id}/team`, {
          role: Role.DESIGNER,
          active: true,
        })
        .expect(200);
      await as(demoted.cookie).get('/audit-log').expect(403);
      await as(demoted.cookie).get('/users').expect(403);
      await as(demoted.cookie).get('/products/manage').expect(200);
    });

    it('a new role starts clean: grants and denials from the old one are dropped', async () => {
      const admin = await signedInAs(app, Role.ADMIN);
      const staff = await staffWith(['books.view'], ['orders.view']);
      await as(admin.cookie)
        .put(`/users/${staff.user.id}/team`, {
          role: Role.DESIGNER,
          active: true,
        })
        .expect(200);
      const row = await prisma.user.findUniqueOrThrow({
        where: { id: staff.user.id },
      });
      expect(row.grantedPermissions).toEqual([]);
      expect(row.deniedPermissions).toEqual([]);
    });
  });

  describe('nobody gets more than an admin gives them', () => {
    it('only admins see or change permissions, even staff holding every permission', async () => {
      const staff = await staffWith([...PERMISSIONS]);
      const other = await signedInAs(app, Role.STAFF);
      await as(staff.cookie).get('/permissions/roles').expect(403);
      await as(staff.cookie)
        .put('/permissions/roles/STAFF', { permissions: [...PERMISSIONS] })
        .expect(403);
      await as(staff.cookie).get(`/users/${other.user.id}/access`).expect(403);
      await as(staff.cookie)
        .put(`/users/${staff.user.id}/access`, { granted: [], denied: [] })
        .expect(403);
      await as(staff.cookie)
        .post('/users/team', { email: 'friend@example.com', role: Role.ADMIN })
        .expect(403);
      await as(staff.cookie)
        .put(`/users/${staff.user.id}/team`, { role: Role.ADMIN, active: true })
        .expect(403);
    });

    it("an admin cannot change their own access, an admin's, or a customer's", async () => {
      const admin = await signedInAs(app, Role.ADMIN);
      const otherAdmin = await signedInAs(app, Role.ADMIN);
      const customer = await signedInAs(app, Role.CUSTOMER);
      const none = { granted: [], denied: [] };
      await as(admin.cookie)
        .put(`/users/${admin.user.id}/access`, none)
        .expect(400);
      await as(admin.cookie)
        .put(`/users/${otherAdmin.user.id}/access`, none)
        .expect(400);
      await as(admin.cookie)
        .put(`/users/${customer.user.id}/access`, none)
        .expect(404);
      await as(admin.cookie)
        .get(`/users/${customer.user.id}/access`)
        .expect(404);
      await as(admin.cookie)
        .put('/permissions/roles/ADMIN', { permissions: [] })
        .expect(400);
      await as(admin.cookie)
        .put('/permissions/roles/CUSTOMER', { permissions: ['orders.view'] })
        .expect(400);
      await as(admin.cookie)
        .put('/permissions/roles/OWNER', { permissions: [] })
        .expect(400);
    });

    it('refuses unknown permissions, a key both given and taken, and extra fields', async () => {
      const admin = await signedInAs(app, Role.ADMIN);
      const staff = await signedInAs(app, Role.STAFF);
      const url = `/users/${staff.user.id}/access`;
      await as(admin.cookie)
        .put(url, { granted: ['team.manage'], denied: [] })
        .expect(400);
      await as(admin.cookie)
        .put(url, { granted: ['*'], denied: [] })
        .expect(400);
      await as(admin.cookie)
        .put(url, { granted: ['orders.view'], denied: ['orders.view'] })
        .expect(400);
      await as(admin.cookie)
        .put(url, { granted: ['books.view', 'books.view'], denied: [] })
        .expect(400);
      await as(admin.cookie)
        .put(url, { granted: [], denied: [], role: Role.ADMIN })
        .expect(400);
      await as(admin.cookie)
        .put('/permissions/roles/STAFF', { permissions: ['admin'] })
        .expect(400);
      const row = await prisma.user.findUniqueOrThrow({
        where: { id: staff.user.id },
      });
      expect(row.role).toBe(Role.STAFF);
      expect(row.grantedPermissions).toEqual([]);
    });

    it('the database itself refuses permissions on a customer or admin account', async () => {
      const customer = await signedInAs(app, Role.CUSTOMER);
      await expect(
        prisma.user.update({
          where: { id: customer.user.id },
          data: { grantedPermissions: ['orders.view'] },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.rolePermissions.create({
          data: { role: Role.CUSTOMER, permissions: ['orders.view'] },
        }),
      ).rejects.toThrow();
    });
  });

  describe('what a page shows depends on the permissions too', () => {
    it("an order's invoices are left out for someone who may see orders but not invoices", async () => {
      const customer = await signedInAs(app, Role.CUSTOMER);
      const product = await createProduct(app);
      await as(customer.cookie)
        .post('/cart/items', { productId: product.id, quantity: 1 })
        .expect(201);
      const placed = await as(customer.cookie)
        .post('/orders/checkout', {
          idempotencyKey: randomUUID(),
          name: 'Rana Khoury',
          phone: '70 123 456',
          paymentMethod: 'TRANSFER',
          delivery: true,
          city: 'Beirut',
          addressLine: 'Hamra St, Bldg 12',
        })
        .expect(201);
      const order = await prisma.order.findUniqueOrThrow({
        where: { orderNumber: placed.body.orderNumber },
      });

      const ordersOnly = await staffWith([], ['invoices.view']);
      const hidden = await as(ordersOnly.cookie)
        .get(`/orders/${order.id}`)
        .expect(200);
      expect(hidden.body.invoices).toBeNull();
      expect(JSON.stringify(hidden.body)).not.toMatch(/"residual"/);

      const both = await signedInAs(app, Role.STAFF);
      const shown = await as(both.cookie)
        .get(`/orders/${order.id}`)
        .expect(200);
      expect(Array.isArray(shown.body.invoices)).toBe(true);
    });
  });

  describe('what each person is told they may do', () => {
    it('/auth/me lists the permissions: all for admins, the role for staff, none for customers', async () => {
      const read = async (role: Role) =>
        (
          await as((await signedInAs(app, role)).cookie)
            .get('/auth/me')
            .expect(200)
        ).body.permissions;
      expect(await read(Role.ADMIN)).toEqual([...PERMISSIONS]);
      const order = (list: readonly string[]) =>
        [...list].sort((a, b) => a.localeCompare(b));
      expect(order(await read(Role.DESIGNER))).toEqual(
        order(DEFAULT_ROLE_PERMISSIONS[Role.DESIGNER]),
      );
      expect(await read(Role.CUSTOMER)).toEqual([]);
    });

    it('the Roles & permissions page shows each role with its members', async () => {
      const admin = await signedInAs(app, Role.ADMIN);
      const body = (
        await as(admin.cookie).get('/permissions/roles').expect(200)
      ).body;
      expect(body.map((r: { role: string }) => r.role)).toEqual([
        Role.STAFF,
        Role.DESIGNER,
      ]);
      expect(body[0].members).toBeGreaterThan(0);
    });
  });
});
