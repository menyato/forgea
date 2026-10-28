import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AccessTokenService } from '../src/authorization/access-token.service.js';
import { ACCESS_COOKIE } from '../src/authorization/auth-cookies.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import { uniqueEmail } from './create-app.js';

export { cube as cubeStl } from '../prisma/example-models.js';

export const CSRF = { 'x-forgea-csrf': '1' };

/** A product priced with the default settings: 60 g PLA, 3 h → $13.91 (docs/PRICING.md). */
export async function createProduct(
  app: NestExpressApplication,
  opts: { isCustom?: boolean } = {},
) {
  const prisma = app.get(PrismaService);
  const pla = await prisma.material.findUniqueOrThrow({
    where: { code: 'PLA' },
  });
  const tag = randomUUID().slice(0, 8);
  return prisma.product.create({
    data: {
      slug: `test-${tag}`,
      name: `Test product ${tag}`,
      description: 'test',
      grams: 60,
      printHours: 3,
      materialId: pla.id,
      isCustom: opts.isCustom ?? false,
    },
  });
}

export const signedInCustomer = (app: NestExpressApplication) =>
  signedInAs(app, Role.CUSTOMER);

/** Raw "name=value" pairs from Set-Cookie, for sending back as a Cookie header. */
export function cookiePairs(
  setCookie: string[] | string | undefined,
): string[] {
  const list = Array.isArray(setCookie)
    ? setCookie
    : setCookie
      ? [setCookie]
      : [];
  return list
    .map((c) => c.split(';')[0]!)
    .filter((pair) => !pair.endsWith('='));
}

/** A signed-in user with this role (staff and admins normally come from Google sign-in). */
export async function signedInAs(app: NestExpressApplication, role: Role) {
  const user = await app.get(PrismaService).user.create({
    data: { email: uniqueEmail(role.toLowerCase()), role },
  });
  const token = await app.get(AccessTokenService).sign({ id: user.id, role });
  return { user, cookie: `${ACCESS_COOKIE}=${token}` };
}
