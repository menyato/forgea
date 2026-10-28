// Local development only: signs in a local admin without Google, so the dashboard can be tried
// before the Google Workspace OAuth credentials exist. It is NOT a login route — nothing in the
// API or the website changes. It needs direct access to a local database, and refuses to run
// in production or against any database that isn't on this machine.
// Used by `pnpm dashboard`; run `pnpm build` first (it uses the compiled API).
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
// The compiled app: its classes carry the decorator metadata Nest's injection needs.
import { AppModule } from '../dist/app.module.js';
import { AccessTokenService } from '../dist/authorization/access-token.service.js';
import { SessionService } from '../dist/auth/session.service.js';
import { PrismaService } from '../dist/database/prisma.service.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const databaseHost = new URL(process.env['DATABASE_URL'] ?? 'postgresql://invalid').hostname;
if (process.env['NODE_ENV'] === 'production' || !LOCAL_HOSTS.has(databaseHost)) {
  throw new Error('Refusing: the dashboard preview is for a local development database only');
}
const email = process.env['BOOTSTRAP_ADMIN_EMAIL'];
if (!email) throw new Error('Set BOOTSTRAP_ADMIN_EMAIL in api/.env (the owner account)');

const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
try {
  const prisma = app.get(PrismaService);
  const user =
    (await prisma.user.findUnique({ where: { email } })) ??
    (await prisma.user.create({
      data: { email, name: 'Owner (local preview)', role: 'ADMIN', emailVerifiedAt: new Date() },
    }));
  // Never promote an existing account: only the owner's own admin account is used.
  if (user.role !== 'ADMIN') throw new Error(`${email} exists and is not an admin`);
  const access = await app.get(AccessTokenService).sign({ id: user.id, role: user.role });
  const refresh = await app
    .get(SessionService)
    .start(user.id, { ip: null, userAgent: 'local dashboard preview' });
  process.stdout.write(JSON.stringify({ email, access, refresh }));
} finally {
  await app.close();
}
