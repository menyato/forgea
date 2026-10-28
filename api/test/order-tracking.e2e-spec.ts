import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AccessTokenService } from '../src/authorization/access-token.service.js';
import { ACCESS_COOKIE } from '../src/authorization/auth-cookies.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import { createProduct, CSRF, signedInCustomer } from './commerce-helpers.js';
import { createApp, uniqueEmail } from './create-app.js';

describe('Order tracking (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let customer: Awaited<ReturnType<typeof signedInCustomer>>;
  let staffCookie: string;
  let staffId: string;
  let standard: { orderNumber: string; id: string };
  let custom: { orderNumber: string; id: string };

  const http = () => request(app.getHttpServer());

  async function placeOrder(isCustom: boolean) {
    const product = await createProduct(app, { isCustom });
    await http()
      .post('/cart/items')
      .set(CSRF)
      .set('Cookie', customer.cookie)
      .send({ productId: product.id })
      .expect(201);
    const res = await http()
      .post('/orders/checkout')
      .set(CSRF)
      .set('Cookie', customer.cookie)
      .send({
        idempotencyKey: randomUUID(),
        name: 'Rana',
        phone: '03 123 456',
        paymentMethod: 'COD',
        delivery: false,
      })
      .expect(201);
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: res.body.orderNumber },
    });
    return { orderNumber: order.orderNumber, id: order.id };
  }

  const setStatus = (
    id: string,
    status: string,
    cookie = staffCookie,
    note?: string,
  ) =>
    http()
      .patch(`/orders/${id}/status`)
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ status, ...(note ? { note } : {}) });

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    customer = await signedInCustomer(app);
    const staff = await prisma.user.create({
      data: { email: uniqueEmail('staff'), role: Role.STAFF },
    });
    staffId = staff.id;
    staffCookie = `${ACCESS_COOKIE}=${await app.get(AccessTokenService).sign({ id: staff.id, role: Role.STAFF })}`;
    standard = await placeOrder(false);
    custom = await placeOrder(true);
  });
  afterAll(() => app.close());

  it('writes the first history row automatically when an order is placed', async () => {
    const res = await http()
      .get('/orders/mine')
      .set('Cookie', customer.cookie)
      .expect(200);
    const mine = res.body.items.find(
      (o: { orderNumber: string }) => o.orderNumber === standard.orderNumber,
    );
    expect(mine.history).toEqual([
      expect.objectContaining({ status: 'PENDING', note: null }),
    ]);
    // Customers never see addresses, phones or internal ids in this view.
    expect(Object.keys(mine)).not.toEqual(
      expect.arrayContaining(['phone', 'addressLine', 'id']),
    );
  });

  it('staff changes are recorded with actor, note and an audit entry', async () => {
    await setStatus(
      standard.id,
      'CONFIRMED',
      staffCookie,
      'Scheduled for Thursday',
    ).expect(200);

    const history = await prisma.orderStatusHistory.findMany({
      where: { orderId: standard.id },
      orderBy: { changedAt: 'asc' },
    });
    expect(history.map((h) => h.status)).toEqual(['PENDING', 'CONFIRMED']);
    expect(history[1]).toMatchObject({
      changedByUserId: staffId,
      note: 'Scheduled for Thursday',
    });
    expect(history[0]?.changedByUserId).toBe(customer.user.id);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'order.status.change', targetId: standard.id },
    });
    expect(audit).toMatchObject({ actorUserId: staffId, targetType: 'Order' });

    const res = await http()
      .get('/orders/mine')
      .set('Cookie', customer.cookie)
      .expect(200);
    const mine = res.body.items.find(
      (o: { orderNumber: string }) => o.orderNumber === standard.orderNumber,
    );
    expect(mine.history.map((h: { status: string }) => h.status)).toEqual([
      'PENDING',
      'CONFIRMED',
    ]);
    expect(mine.history[1].note).toBe('Scheduled for Thursday');
  });

  it('refuses transitions outside the status flow, and non-staff', async () => {
    const res = await setStatus(standard.id, 'DELIVERED').expect(400);
    expect(res.body.message).toMatch(
      /can only become: IN_PRODUCTION, CANCELLED/,
    );
    await setStatus(standard.id, 'IN_PRODUCTION', customer.cookie).expect(403);
    await http()
      .patch(`/orders/${standard.id}/status`)
      .set(CSRF)
      .send({ status: 'IN_PRODUCTION' })
      .expect(401);
  });

  it('marks the deposit paid when a custom order moves from awaiting deposit to confirmed', async () => {
    await setStatus(custom.id, 'IN_PRODUCTION').expect(400); // deposit first
    await setStatus(custom.id, 'CONFIRMED').expect(200);
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: custom.id },
    });
    expect(order.depositPaid).toBe(true);
  });

  it('the database records a status change even when made outside the app', async () => {
    await prisma.$executeRaw`UPDATE orders SET status = 'IN_PRODUCTION' WHERE id = ${custom.id}::uuid`;
    const last = await prisma.orderStatusHistory.findFirstOrThrow({
      where: { orderId: custom.id },
      orderBy: { changedAt: 'desc' },
    });
    expect(last).toMatchObject({
      status: 'IN_PRODUCTION',
      changedByUserId: null,
    });
  });

  it('history is append-only', async () => {
    await expect(
      prisma.$executeRaw`UPDATE order_status_history SET note = 'edited' WHERE "orderId" = ${custom.id}::uuid`,
    ).rejects.toThrow(/append-only/);
  });
});
