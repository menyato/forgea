import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import { CSRF, signedInAs } from './commerce-helpers.js';
import { createApp } from './create-app.js';
import {
  createStudio,
  moveOrder,
  placeOrder,
  type Studio,
} from './studio-helpers.js';

/**
 * Merging one customer into another: orders, invoices, their history and quotations become
 * the kept customer's, and the merged account is gone. The ledger still refuses any change
 * but who an entry points at.
 */
describe('Merging customers (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: Awaited<ReturnType<typeof signedInAs>>;
  let studio: Studio;
  const merge = (body: object, cookie = admin.cookie) =>
    request(app.getHttpServer())
      .post('/customers/merge')
      .set(CSRF)
      .set('Cookie', cookie)
      .send(body);

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    admin = await signedInAs(app, Role.ADMIN);
    studio = await createStudio(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('moves orders, invoices and their history to the kept customer, then removes the other', async () => {
    const walkIn = await signedInAs(app, Role.CUSTOMER);
    const kept = await signedInAs(app, Role.CUSTOMER);
    const order = await placeOrder(
      app,
      walkIn.cookie,
      studio,
      { size: 'standard', colour: 'red', quantity: 1 },
      { paymentMethod: 'COD', delivery: false },
    );
    await moveOrder(app, admin.cookie, order.id, [
      'CONFIRMED',
      'IN_PRODUCTION',
      'READY',
      'DELIVERED',
    ]);
    const entries = await prisma.journalEntry.findMany({
      where: { customerId: walkIn.user.id, state: 'POSTED' },
      include: { lines: { orderBy: { id: 'asc' } } },
    });
    expect(entries.length).toBeGreaterThan(0);

    const r = await merge({
      from: walkIn.user.email,
      into: kept.user.email,
    }).expect(200);
    expect(r.body).toMatchObject({
      into: kept.user.email,
      moved: { orders: 1, entries: entries.length },
    });

    expect(await prisma.user.count({ where: { id: walkIn.user.id } })).toBe(0);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: order.id } }))
        .userId,
    ).toBe(kept.user.id);
    const after = await prisma.journalEntry.findMany({
      where: { id: { in: entries.map((e) => e.id) } },
      include: { lines: { orderBy: { id: 'asc' } } },
    });
    // The same entries, the same amounts, now the kept customer's.
    for (const e of after) {
      expect(e.customerId).toBe(kept.user.id);
      const before = entries.find((x) => x.id === e.id)!;
      expect(e.number).toBe(before.number);
      expect(
        e.lines.map((l) => [l.debit.toString(), l.credit.toString()]),
      ).toEqual(
        before.lines.map((l) => [l.debit.toString(), l.credit.toString()]),
      );
    }
    // Who placed it now reads as the kept customer.
    expect(
      await prisma.orderStatusHistory.count({
        where: { changedByUserId: walkIn.user.id },
      }),
    ).toBe(0);

    // The database still refuses anything else on a posted entry.
    await expect(
      prisma.$executeRaw`UPDATE "journal_entries" SET "date" = "date" + 1 WHERE "id" = ${after[0]!.id}::uuid`,
    ).rejects.toThrow(/posted/);
    await expect(
      prisma.$executeRaw`DELETE FROM "order_status_history" WHERE "orderId" = ${order.id}::uuid`,
    ).rejects.toThrow(/append-only/);
  });

  it('merges customers only, by an admin, into someone else', async () => {
    const a = await signedInAs(app, Role.CUSTOMER);
    const staff = await signedInAs(app, Role.STAFF);
    await merge({ from: a.user.email, into: a.user.email }).expect(400);
    await merge({ from: a.user.email, into: staff.user.email }).expect(400);
    await merge({ from: a.user.email, into: 'nobody@example.com' }).expect(404);
    await merge(
      { from: a.user.email, into: admin.user.email },
      staff.cookie,
    ).expect(403);
    expect(await prisma.user.count({ where: { id: a.user.id } })).toBe(1);
  });

  it("an admin corrects a customer account's name and phone, never a team account's", async () => {
    const c = await signedInAs(app, Role.CUSTOMER);
    const staff = await signedInAs(app, Role.STAFF);
    const put = (body: object, cookie = admin.cookie) =>
      request(app.getHttpServer())
        .put('/customers/details')
        .set(CSRF)
        .set('Cookie', cookie)
        .send(body);
    await put({
      email: c.user.email,
      name: 'Labs Print',
      phone: '70 123 456',
    }).expect(204);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: c.user.id } }),
    ).toMatchObject({ name: 'Labs Print' });
    await put({
      email: staff.user.email,
      name: 'X',
      phone: '70 123 456',
    }).expect(404);
    await put(
      { email: c.user.email, name: 'X', phone: '70 123 456' },
      staff.cookie,
    ).expect(403);
  });
});
