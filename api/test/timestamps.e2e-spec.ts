import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/database/prisma.service.js';
import { createApp, uniqueEmail } from './create-app.js';

// Guards against time-zone shifts between the app and Postgres: a timestamp written by the
// app must equal the database's own clock, whatever time zone the server is set to.
describe('Timestamps (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });
  afterAll(() => app.close());

  it('stores app-written times exactly (no time-zone offset)', async () => {
    const user = await prisma.user.create({
      data: { email: uniqueEmail('tz') },
    });
    const [row] = await prisma.$queryRaw<{ drift: number }[]>`
      SELECT abs(extract(epoch FROM (now() - "createdAt"))) AS drift FROM users WHERE id = ${user.id}::uuid`;
    expect(Number(row?.drift)).toBeLessThan(60);
  });

  it('compares app-supplied times correctly against database-written ones', async () => {
    const [row] = await prisma.$queryRaw<
      { db_now: Date }[]
    >`SELECT now() AS db_now`;
    const found = await prisma.exchangeRate.findFirst({
      where: { currencyCode: 'LBP', effectiveFrom: { lte: new Date() } },
    });
    expect(row?.db_now).toBeInstanceOf(Date);
    // The migration-seeded rate (written by Postgres itself) must already be in force.
    expect(found).not.toBeNull();
  });
});
