import { createHash, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ExpiredSessionsCleaner } from '../src/auth/expired-sessions-cleaner.js';
import { AbandonedCartsCleaner } from '../src/cart/abandoned-carts-cleaner.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import { signedInAs } from './commerce-helpers.js';
import { createApp } from './create-app.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The daily clean-ups delete only what can never be used again. */
describe('Clean-ups (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });
  afterAll(() => app.close());

  it('removes sessions a day past expiry; keeps recent and revoked-but-live ones', async () => {
    const { user } = await signedInAs(app, Role.CUSTOMER);
    const now = new Date();
    const session = (expiresAt: Date, revokedAt: Date | null = null) =>
      prisma.session.create({
        data: {
          userId: user.id,
          tokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
          familyId: randomUUID(),
          expiresAt,
          revokedAt,
        },
      });
    const old = await session(new Date(now.getTime() - 2 * DAY));
    const justExpired = await session(new Date(now.getTime() - HOUR));
    const revoked = await session(new Date(now.getTime() + DAY), now);

    expect(await app.get(ExpiredSessionsCleaner).run(now)).toBeGreaterThan(0);
    const left = await prisma.session.findMany({
      where: { id: { in: [old.id, justExpired.id, revoked.id] } },
      select: { id: true },
    });
    expect(left.map((s) => s.id).sort()).toEqual(
      [justExpired.id, revoked.id].sort(),
    );
  });

  it("removes visitors' carts untouched for 30 days, never a customer's", async () => {
    const { user } = await signedInAs(app, Role.CUSTOMER);
    const now = new Date();
    const longAgo = new Date(now.getTime() - 31 * DAY);
    const oldGuest = await prisma.cart.create({ data: { updatedAt: longAgo } });
    const freshGuest = await prisma.cart.create({ data: {} });
    const oldCustomer = await prisma.cart.create({
      data: { userId: user.id, updatedAt: longAgo },
    });

    await app.get(AbandonedCartsCleaner).run(now);
    const left = await prisma.cart.findMany({
      where: { id: { in: [oldGuest.id, freshGuest.id, oldCustomer.id] } },
      select: { id: true },
    });
    expect(left.map((c) => c.id).sort()).toEqual(
      [freshGuest.id, oldCustomer.id].sort(),
    );
  });
});
