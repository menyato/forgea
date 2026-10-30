import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { EnvironmentVariables } from '../config/environment.js';
import { Role } from '../generated/prisma/enums.js';
import { AccessTokenService } from './access-token.service.js';
import { ACCESS_COOKIE, AuthCookies } from './auth-cookies.js';
import { ACCESS, IS_PUBLIC } from './decorators.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PermissionsGuard } from './permissions.guard.js';
import type { CurrentAccess, TeamPermissions } from './team-permissions.js';

const SECRET = 'test-secret-that-is-at-least-32-chars-long';
const config = new ConfigService({
  ACCESS_TOKEN_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_DAYS: 30,
}) as ConfigService<EnvironmentVariables, true>;
const tokens = new AccessTokenService(
  new JwtService({ secret: SECRET }),
  config,
);
const cookies = new AuthCookies(config);

/** A fake route: metadata for the handler, cookies and user on the request. */
function route(
  meta: Record<string, unknown>,
  req: Record<string, unknown> = {},
) {
  const handler = () => undefined;
  for (const [k, v] of Object.entries(meta))
    Reflect.defineMetadata(k, v, handler);
  const request = { cookies: {}, ...req };
  const ctx = {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, request: request as { user?: unknown } };
}

describe('AccessTokenService', () => {
  it('round-trips a user', async () => {
    const token = await tokens.sign({ id: 'u1', role: Role.STAFF });
    await expect(tokens.verify(token)).resolves.toEqual({
      id: 'u1',
      role: Role.STAFF,
    });
  });

  it('rejects a token signed with another secret', async () => {
    const other = new AccessTokenService(
      new JwtService({ secret: 'x'.repeat(40) }),
      config,
    );
    const forged = await other.sign({ id: 'u1', role: Role.ADMIN });
    await expect(tokens.verify(forged)).resolves.toBeNull();
  });

  it('rejects an unsigned "alg: none" token', async () => {
    const enc = (o: object) =>
      Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: 'u1', role: 'ADMIN', iss: 'forgea-api', aud: 'forgea' })}.`;
    await expect(tokens.verify(none)).resolves.toBeNull();
  });

  it('rejects a token for another audience', async () => {
    const jwt = new JwtService({ secret: SECRET });
    const token = await jwt.signAsync(
      { sub: 'u1', role: 'ADMIN' },
      { issuer: 'forgea-api', audience: 'other' },
    );
    await expect(tokens.verify(token)).resolves.toBeNull();
  });

  it('rejects an unknown role', async () => {
    const jwt = new JwtService({ secret: SECRET });
    const token = await jwt.signAsync(
      { sub: 'u1', role: 'SUPERUSER' },
      { issuer: 'forgea-api', audience: 'forgea' },
    );
    await expect(tokens.verify(token)).resolves.toBeNull();
  });
});

describe('JwtAuthGuard', () => {
  const guard = new JwtAuthGuard(new Reflector(), tokens, cookies);

  it('rejects anonymous requests to protected routes', async () => {
    await expect(guard.canActivate(route({}).ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('lets anonymous requests reach @Public() routes', async () => {
    await expect(
      guard.canActivate(route({ [IS_PUBLIC]: true }).ctx),
    ).resolves.toBe(true);
  });

  it('attaches the user from a valid access cookie', async () => {
    const token = await tokens.sign({ id: 'u1', role: Role.CUSTOMER });
    const { ctx, request } = route({}, { cookies: { [ACCESS_COOKIE]: token } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'u1', role: Role.CUSTOMER });
  });

  it('also attaches the user on public routes', async () => {
    const token = await tokens.sign({ id: 'u2', role: Role.CUSTOMER });
    const { ctx, request } = route(
      { [IS_PUBLIC]: true },
      { cookies: { [ACCESS_COOKIE]: token } },
    );
    await guard.canActivate(ctx);
    expect(request.user).toEqual({ id: 'u2', role: Role.CUSTOMER });
  });

  it('treats a garbage cookie as anonymous', async () => {
    const { ctx } = route({}, { cookies: { [ACCESS_COOKIE]: 'garbage' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });
});

describe('PermissionsGuard', () => {
  /** What the database says about each user, whatever their token claims. */
  const db = new Map<string, CurrentAccess>([
    ['admin', { role: Role.ADMIN, disabled: false, permissions: [] }],
    [
      'staff',
      { role: Role.STAFF, disabled: false, permissions: ['orders.view'] },
    ],
    ['off', { role: Role.STAFF, disabled: true, permissions: ['orders.view'] }],
    ['customer', { role: Role.CUSTOMER, disabled: false, permissions: [] }],
  ]);
  const team = {
    current: async (id: string) => db.get(id) ?? null,
  } as unknown as TeamPermissions;
  const guard = new PermissionsGuard(new Reflector(), team);
  /** A request by `id` whose token says `role`, on a route needing `access`. */
  const call = (id: string | null, access?: string, role: Role = Role.STAFF) =>
    route(access ? { [ACCESS]: access } : {}, id ? { user: { id, role } } : {});

  it('lets any signed-in user through routes that need no permission', async () => {
    await expect(guard.canActivate(call('customer').ctx)).resolves.toBe(true);
  });

  it('lets admins through everything, admin-only routes included', async () => {
    await expect(
      guard.canActivate(call('admin', 'books.manage').ctx),
    ).resolves.toBe(true);
    await expect(guard.canActivate(call('admin', 'admin').ctx)).resolves.toBe(
      true,
    );
  });

  it('lets a team member through only with the permission', async () => {
    await expect(
      guard.canActivate(call('staff', 'orders.view').ctx),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(call('staff', 'orders.manage').ctx),
    ).rejects.toThrow(ForbiddenException);
  });

  it('never lets a team member through an admin-only route', async () => {
    await expect(guard.canActivate(call('staff', 'admin').ctx)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('believes the database, not the token: an old ADMIN token gets nothing extra', async () => {
    await expect(
      guard.canActivate(call('staff', 'books.view', Role.ADMIN).ctx),
    ).rejects.toThrow(ForbiddenException);
    const allowed = call('staff', 'orders.view', Role.ADMIN);
    await guard.canActivate(allowed.ctx);
    // Handlers then see the role as it is now.
    expect(allowed.request.user).toEqual({ id: 'staff', role: Role.STAFF });
  });

  it('refuses someone switched off, a customer, a deleted account and nobody', async () => {
    for (const id of ['off', 'customer', 'gone', null]) {
      await expect(
        guard.canActivate(call(id, 'orders.view').ctx),
      ).rejects.toThrow(ForbiddenException);
    }
  });
});
