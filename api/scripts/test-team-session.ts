// Browser tests only: a new staff member or designer, signed in, on the local *test* database
// (team members sign in with Google, which tests can't use). Refuses any other database.
//   node scripts/test-team-session.ts STAFF|DESIGNER   → {"id","email","access","refresh"}
// Run `pnpm build` first (it uses the compiled API).
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
// The compiled app: its classes carry the decorator metadata Nest's injection needs.
import { AppModule } from '../dist/app.module.js';
import { AccessTokenService } from '../dist/authorization/access-token.service.js';
import { SessionService } from '../dist/auth/session.service.js';
import { PrismaService } from '../dist/database/prisma.service.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const database = new URL(process.env['DATABASE_URL'] ?? 'postgresql://invalid');
if (
  process.env['NODE_ENV'] === 'production' ||
  !LOCAL_HOSTS.has(database.hostname) ||
  !database.pathname.endsWith('_test')
) {
  throw new Error(
    'Refusing: test team members go only in the local test database',
  );
}
const role = process.argv[2];
if (role !== 'STAFF' && role !== 'DESIGNER')
  throw new Error('Usage: STAFF | DESIGNER');

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: false,
});
try {
  const domain = process.env['WORKSPACE_DOMAIN'] ?? 'example.com';
  const user = await app.get(PrismaService).user.create({
    data: {
      email: `${role.toLowerCase()}-${randomUUID().slice(0, 8)}@${domain}`,
      name: `Test ${role.toLowerCase()}`,
      role,
      googleId: `test-${randomUUID()}`,
      emailVerifiedAt: new Date(),
    },
  });
  const access = await app
    .get(AccessTokenService)
    .sign({ id: user.id, role: user.role });
  const refresh = await app
    .get(SessionService)
    .start(user.id, { ip: null, userAgent: 'browser test' });
  process.stdout.write(
    JSON.stringify({ id: user.id, email: user.email, access, refresh }),
  );
} finally {
  await app.close();
}
