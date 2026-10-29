import { createHash, randomUUID } from 'node:crypto';
import { palettes } from '@forgea/brand';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import {
  CSRF,
  createProduct,
  signedInAs,
  signedInCustomer,
} from './commerce-helpers.js';
import { createApp } from './create-app.js';

/** Phase 8b dashboard endpoints: pricing, rates, order detail, team, theme. */
describe('Dashboard (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    put: (url: string, body: object) =>
      http().put(url).set(CSRF).set('Cookie', cookie).send(body),
    post: (url: string, body: object) =>
      http().post(url).set(CSRF).set('Cookie', cookie).send(body),
    patch: (url: string, body: object) =>
      http().patch(url).set(CSRF).set('Cookie', cookie).send(body),
    delete: (url: string) => http().delete(url).set(CSRF).set('Cookie', cookie),
  });

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await prisma.siteTheme.deleteMany();
    await app.close();
  });

  describe('pricing settings', () => {
    it('admins read and change every setting; the next quote uses them; logged', async () => {
      const admin = await signedInAs(app, Role.ADMIN);
      await as((await signedInAs(app, Role.STAFF)).cookie)
        .get('/pricing/settings')
        .expect(403);
      const before = (
        await as(admin.cookie).get('/pricing/settings').expect(200)
      ).body;
      expect(Object.keys(before.cost)).toContain('markupMultiplier');

      const form = {
        ...before.cost,
        ...before.order,
        bulkDiscountTiers: before.order.bulkDiscountTiers,
      };
      await as(admin.cookie)
        .put('/pricing/settings', {
          ...form,
          bulkDiscountTiers: [
            { minQuantity: 5, percent: '5' },
            { minQuantity: 5, percent: '10' },
          ],
        })
        .expect(400);
      await as(admin.cookie)
        .put('/pricing/settings', { ...form, depositPercent: '101' })
        .expect(400);

      try {
        const res = await as(admin.cookie)
          .put('/pricing/settings', { ...form, deliveryFee: '7.00' })
          .expect(200);
        expect(res.body.order.deliveryFee).toBe('7.00');
        expect(
          (await http().get('/pricing/order-settings')).body.deliveryFee,
        ).toBe('7');
        await prisma.auditLog.findFirstOrThrow({
          where: {
            actorUserId: admin.user.id,
            action: 'settings.pricing.update',
          },
        });
      } finally {
        await as(admin.cookie).put('/pricing/settings', form).expect(200);
      }
    });
  });

  it('admins see who set each exchange rate, newest first', async () => {
    const admin = await signedInAs(app, Role.ADMIN);
    await as(admin.cookie)
      .put('/currencies/LBP/rate', { rate: '89600' })
      .expect(200);
    const res = await as(admin.cookie).get('/currencies/lbp/rates').expect(200);
    expect(res.body[0]).toMatchObject({
      rate: '89600',
      setBy: admin.user.email,
    });
    await as(admin.cookie).get('/currencies/XXX/rates').expect(404);
    await as((await signedInCustomer(app)).cookie)
      .get('/currencies/LBP/rates')
      .expect(403);
  });

  it('staff open an order with everything needed to deliver it and the next steps', async () => {
    const product = await createProduct(app, { isCustom: true });
    const customer = await signedInCustomer(app);
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
    const { id } = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: placed.body.orderNumber },
    });
    const staff = await signedInAs(app, Role.STAFF);
    await as(customer.cookie).get(`/orders/${id}`).expect(403);

    const order = (await as(staff.cookie).get(`/orders/${id}`).expect(200))
      .body;
    expect(order).toMatchObject({
      orderNumber: placed.body.orderNumber,
      status: 'AWAITING_DEPOSIT',
      nextStatuses: ['CONFIRMED', 'CANCELLED'],
      customer: { name: 'Rana Khoury', phone: '70 123 456' },
      city: 'Beirut',
      depositPaid: false,
      items: [
        expect.objectContaining({ productSlug: product.slug, isCustom: true }),
      ],
      customRequestNumber: null,
    });
    expect(order.priceBreakdown.length).toBeGreaterThan(0);

    // "Deposit received": confirming records who did it and marks the deposit paid.
    await as(staff.cookie)
      .patch(`/orders/${id}/status`, {
        status: 'CONFIRMED',
        note: 'Deposit by Whish',
      })
      .expect(200);
    const after = (await as(staff.cookie).get(`/orders/${id}`)).body;
    expect(after.depositPaid).toBe(true);
    expect(after.history.at(-1)).toMatchObject({
      status: 'CONFIRMED',
      note: 'Deposit by Whish',
      changedBy: staff.user.email,
    });
    await as(staff.cookie).get(`/orders/${randomUUID()}`).expect(404);
  });

  describe('team', () => {
    const domain = 'forgea-lab.com';
    const workspaceEmail = () => `team-${randomUUID().slice(0, 8)}@${domain}`;

    it('admins add Workspace accounts only, once each; logged', async () => {
      const admin = await signedInAs(app, Role.ADMIN);
      await as((await signedInAs(app, Role.STAFF)).cookie)
        .post('/users/team', { email: workspaceEmail(), role: 'STAFF' })
        .expect(403);
      await as(admin.cookie)
        .post('/users/team', { email: 'someone@gmail.com', role: 'STAFF' })
        .expect(400);
      await as(admin.cookie)
        .post('/users/team', { email: workspaceEmail(), role: 'CUSTOMER' })
        .expect(400);

      const email = workspaceEmail();
      const res = await as(admin.cookie)
        .post('/users/team', {
          email: email.toUpperCase(),
          name: 'Maya',
          role: 'STAFF',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        email,
        role: 'STAFF',
        signIn: [],
        disabled: false,
      });
      await as(admin.cookie)
        .post('/users/team', { email, role: 'ADMIN' })
        .expect(409);
      const list = await as(admin.cookie)
        .get(`/users?role=STAFF&q=${encodeURIComponent(email)}`)
        .expect(200);
      expect(list.body.items.map((u: { email: string }) => u.email)).toEqual([
        email,
      ]);
      await prisma.auditLog.findFirstOrThrow({
        where: { action: 'user.team.add', targetId: res.body.id },
      });
    });

    it('switching someone off ends their sessions and their access', async () => {
      const admin = await signedInAs(app, Role.ADMIN);
      const staff = await signedInAs(app, Role.STAFF);
      await prisma.session.create({
        data: {
          userId: staff.user.id,
          tokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
          familyId: randomUUID(),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      await as(staff.cookie).get('/auth/me').expect(200);

      const res = await as(admin.cookie)
        .put(`/users/${staff.user.id}/team`, { role: 'STAFF', active: false })
        .expect(200);
      expect(res.body.disabled).toBe(true);
      expect(
        await prisma.session.count({
          where: { userId: staff.user.id, revokedAt: null },
        }),
      ).toBe(0);
      // Their last access token no longer opens the dashboard.
      await as(staff.cookie).get('/auth/me').expect(401);

      const back = await as(admin.cookie)
        .put(`/users/${staff.user.id}/team`, { role: 'ADMIN', active: true })
        .expect(200);
      expect(back.body).toMatchObject({ role: 'ADMIN', disabled: false });
    });

    it('refuses changing yourself, customers, and removing the last admin', async () => {
      const admin = await signedInAs(app, Role.ADMIN);
      await as(admin.cookie)
        .put(`/users/${admin.user.id}/team`, { role: 'STAFF', active: true })
        .expect(400);
      const customer = await signedInCustomer(app);
      await as(admin.cookie)
        .put(`/users/${customer.user.id}/team`, { role: 'STAFF', active: true })
        .expect(400);
      await as(admin.cookie)
        .put(`/users/${randomUUID()}/team`, { role: 'STAFF', active: true })
        .expect(404);

      // With every other admin switched off, this one can't be demoted by anyone.
      const other = await signedInAs(app, Role.ADMIN);
      const others = await prisma.user.findMany({
        where: { role: 'ADMIN', disabledAt: null, id: { not: admin.user.id } },
        select: { id: true },
      });
      await prisma.user.updateMany({
        where: { id: { in: others.map((o) => o.id) } },
        data: { disabledAt: new Date() },
      });
      try {
        const res = await as(other.cookie)
          .put(`/users/${admin.user.id}/team`, { role: 'STAFF', active: true })
          .expect(400);
        expect(res.body.message).toMatch(/at least one admin/);
      } finally {
        await prisma.user.updateMany({
          where: { id: { in: others.map((o) => o.id) } },
          data: { disabledAt: null },
        });
      }
    });
  });

  describe('site theme', () => {
    it('anyone reads it; admins save a readable palette and reset it; logged', async () => {
      await prisma.siteTheme.deleteMany();
      expect((await http().get('/site-theme').expect(200)).body).toEqual({
        theme: null,
      });
      const admin = await signedInAs(app, Role.ADMIN);
      await as((await signedInAs(app, Role.STAFF)).cookie)
        .put('/site-theme', { palette: palettes.resin, basedOn: 'resin' })
        .expect(403);

      const unreadable = await as(admin.cookie)
        .put('/site-theme', {
          palette: {
            ...palettes.copper,
            accent: '#f0f0f0',
            onAccent: '#ffffff',
          },
          basedOn: 'copper',
        })
        .expect(400);
      expect(unreadable.body.message).toMatch(/Text on buttons \(light\)/);
      // The owner may keep it anyway, by confirming.
      await as(admin.cookie)
        .put('/site-theme', {
          palette: {
            ...palettes.copper,
            accent: '#f0f0f0',
            onAccent: '#ffffff',
          },
          basedOn: 'custom',
          allowLowContrast: true,
        })
        .expect(200);
      await as(admin.cookie)
        .put('/site-theme', {
          palette: { ...palettes.copper, red: 'red' },
          basedOn: 'copper',
        })
        .expect(400);
      await as(admin.cookie)
        .put('/site-theme', { palette: palettes.copper, basedOn: 'nope' })
        .expect(400);

      const saved = await as(admin.cookie)
        .put('/site-theme', { palette: palettes.maroon, basedOn: 'maroon' })
        .expect(200);
      expect(saved.body.theme).toMatchObject({
        palette: palettes.maroon,
        basedOn: 'maroon',
      });
      expect((await http().get('/site-theme')).body.theme.basedOn).toBe(
        'maroon',
      );

      await as(admin.cookie).delete('/site-theme').expect(200, { theme: null });
      expect((await http().get('/site-theme')).body).toEqual({ theme: null });
      // Every attempt is logged before it runs (6: the 3 refused palettes and the 3 changes),
      // and each refused one also gets a 'failed' row.
      const logged = {
        actorUserId: admin.user.id,
        action: { in: ['site-theme.update', 'site-theme.reset'] },
      };
      expect(await prisma.auditLog.count({ where: logged })).toBe(9);
      expect(
        await prisma.auditLog.count({
          where: {
            ...logged,
            metadata: { path: ['outcome'], equals: 'failed' },
          },
        }),
      ).toBe(3);
    });
  });

  it('designers choose what stands on the home page bed, in order; only models qualify', async () => {
    const before = await prisma.product.findMany({
      where: { plateOrder: { not: null } },
      select: { id: true, plateOrder: true },
    });
    const designer = await signedInAs(app, Role.DESIGNER);
    const withModel = async () => {
      const p = await createProduct(app);
      const upload = await prisma.upload.findFirstOrThrow({
        where: { purpose: 'PRODUCT_MODEL', status: 'CLEAN' },
      });
      return prisma.product.update({
        where: { id: p.id },
        data: { modelFileKey: upload.storageKey },
      });
    };
    const [a, b] = [await withModel(), await withModel()];
    try {
      await as((await signedInCustomer(app)).cookie)
        .put('/products/plate', { productIds: [a.id] })
        .expect(403);
      const noModel = await createProduct(app);
      await as(designer.cookie)
        .put('/products/plate', { productIds: [noModel.id] })
        .expect(400);
      await as(designer.cookie)
        .put('/products/plate', { productIds: [a.id, a.id] })
        .expect(400);

      const res = await as(designer.cookie)
        .put('/products/plate', { productIds: [b.id, a.id] })
        .expect(200);
      expect(res.body.chosen).toBe(true);
      const shown = await http().get('/products/plate').expect(200);
      expect(shown.body.products.map((p: { id: string }) => p.id)).toEqual([
        b.id,
        a.id,
      ]);

      // Nothing chosen: the newest products with a model stand in.
      await as(designer.cookie)
        .put('/products/plate', { productIds: [] })
        .expect(200);
      const fallback = (await http().get('/products/plate')).body;
      expect(fallback.chosen).toBe(false);
      expect(fallback.products.length).toBeGreaterThan(0);
      expect(
        fallback.products.every((p: { modelKey: string | null }) => p.modelKey),
      ).toBe(true);
    } finally {
      await prisma.product.updateMany({ data: { plateOrder: null } });
      for (const p of before) {
        await prisma.product.update({
          where: { id: p.id },
          data: { plateOrder: p.plateOrder },
        });
      }
    }
  });
});
