import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenService } from '../authorization/access-token.service.js';
import { EmailVerificationTokens } from '../authorization/email-verification-tokens.js';
import type { Notifications } from '../mail/notifications.service.js';
import type {
  AuditEntry,
  AuditLogService,
} from '../audit-log/audit-log.service.js';
import type { EnvironmentVariables } from '../config/environment.js';
import type { User } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';
import type {
  NewCustomer,
  UsersRepository,
} from '../users/users.repository.js';
import { AuthService } from './auth.service.js';
import type { TeamPermissions } from '../authorization/team-permissions.js';
import { PasswordResetTokens } from '../authorization/password-reset-tokens.js';
import { LoginAttempts } from './login-attempts.js';
import type { GoogleClaims } from './google-oidc.js';
import { PasswordHasher } from './password-hasher.js';
import type { SessionService } from './session.service.js';

/** In-memory stand-in for the users table. */
class FakeUsers {
  rows: User[] = [];
  private seq = 0;
  private make(data: Partial<User> & { email: string; role: Role }): User {
    const user: User = {
      id: `u${++this.seq}`,
      name: null,
      phone: null,
      disabledAt: null,
      grantedPermissions: [],
      deniedPermissions: [],
      googleId: null,
      passwordHash: null,
      emailVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    };
    this.rows.push(user);
    return user;
  }
  add = (data: Partial<User> & { email: string; role: Role }) =>
    this.make(data);
  findById = async (id: string) => this.rows.find((u) => u.id === id) ?? null;
  findByEmail = async (email: string) =>
    this.rows.find((u) => u.email === email) ?? null;
  findByGoogleId = async (g: string) =>
    this.rows.find((u) => u.googleId === g) ?? null;
  createCustomer = async (d: NewCustomer) =>
    this.make({ ...d, name: d.name ?? null, role: Role.CUSTOMER });
  createBootstrapAdmin = async (d: {
    email: string;
    name?: string | undefined;
    googleId: string;
  }) =>
    this.make({
      ...d,
      name: d.name ?? null,
      role: Role.ADMIN,
      emailVerifiedAt: new Date(),
    });
  linkGoogle = async (user: User, googleId: string) => {
    const unverified = user.emailVerifiedAt === null;
    Object.assign(user, {
      googleId,
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      ...(unverified ? { passwordHash: null } : {}),
    });
    return user;
  };
  adminExists = async () => this.rows.some((u) => u.role === Role.ADMIN);
  markEmailVerified = async (id: string) => {
    const u = this.rows.find((r) => r.id === id)!;
    u.emailVerifiedAt = new Date();
    return u;
  };
}

const config = new ConfigService({
  ACCESS_TOKEN_TTL_SECONDS: 900,
  WORKSPACE_DOMAIN: 'forgea-lab.com',
  BOOTSTRAP_ADMIN_EMAIL: 'owner@forgea-lab.com',
}) as ConfigService<EnvironmentVariables, true>;
const ctx = { ip: '1.2.3.4', userAgent: 'test' };

describe('AuthService', () => {
  let sent: { template: string; to: string; token?: string }[] = [];
  let users: FakeUsers;
  let audit: AuditEntry[];
  let service: AuthService;
  const passwords = new PasswordHasher();

  beforeAll(() => passwords.onModuleInit());

  beforeEach(() => {
    users = new FakeUsers();
    audit = [];
    const sessions = {
      start: async () => 'refresh-token',
    } as unknown as SessionService;
    const auditLog = {
      record: async (e: AuditEntry) => void audit.push(e),
    } as unknown as AuditLogService;
    const jwt = new JwtService({ secret: 'x'.repeat(40) });
    const tokens = new AccessTokenService(jwt, config);
    sent = [];
    const notifications = {
      send: (template: string, data: { to: string; token?: string }) =>
        void sent.push({ template, ...data }),
    } as unknown as Notifications;
    service = new AuthService(
      users as unknown as UsersRepository,
      passwords,
      sessions,
      tokens,
      auditLog,
      new EmailVerificationTokens(jwt),
      notifications,
      new LoginAttempts(),
      new PasswordResetTokens(jwt),
      { of: async () => [] } as unknown as TeamPermissions,
      config,
    );
  });

  const google = (over: Partial<GoogleClaims>): GoogleClaims => ({
    sub: 'g-1',
    email: 'sara@gmail.com',
    emailVerified: true,
    hostedDomain: undefined,
    name: 'Sara',
    ...over,
  });

  describe('email + password', () => {
    it('signs in a customer with the right password', async () => {
      users.add({
        email: 'a@b.co',
        role: Role.CUSTOMER,
        passwordHash: await passwords.hash('right password!'),
      });
      const session = await service.loginWithPassword(
        { email: 'a@b.co', password: 'right password!' },
        ctx,
      );
      expect(session.profile.role).toBe(Role.CUSTOMER);
      expect(session.landingPath).toBe('customer');
    });

    it('gives the same error for a wrong password, an unknown email and a Google-only account', async () => {
      users.add({
        email: 'a@b.co',
        role: Role.CUSTOMER,
        passwordHash: await passwords.hash('right password!'),
      });
      users.add({ email: 'g@b.co', role: Role.CUSTOMER, googleId: 'g' });
      const attempts = [
        { email: 'a@b.co', password: 'wrong' },
        { email: 'nobody@b.co', password: 'wrong' },
        { email: 'g@b.co', password: 'anything' },
      ];
      for (const dto of attempts) {
        await expect(service.loginWithPassword(dto, ctx)).rejects.toThrow(
          'Email or password is incorrect',
        );
      }
    });
  });

  describe('email verification', () => {
    const register = () =>
      service.register(
        {
          email: 'nadia@example.com',
          password: 'correct-horse-battery-9',
          name: 'Nadia',
        },
        ctx,
      );

    it('emails a link when a customer registers; the link confirms the address', async () => {
      const { profile } = await register();
      expect(sent).toEqual([
        expect.objectContaining({
          template: 'verifyEmail',
          to: 'nadia@example.com',
        }),
      ]);
      const verified = await service.verifyEmail(sent[0]!.token!);
      expect(verified.id).toBe(profile.id);
      expect(users.rows[0]!.emailVerifiedAt).not.toBeNull();
    });

    it('refuses a tampered link, and a link for an address the account no longer has', async () => {
      await register();
      const token = sent[0]!.token!;
      await expect(service.verifyEmail(`${token}x`)).rejects.toThrow(
        /expired or is not valid/,
      );
      users.rows[0]!.email = 'changed@example.com';
      await expect(service.verifyEmail(token)).rejects.toThrow(
        /expired or is not valid/,
      );
    });

    it('sends a new link only while the address is unconfirmed', async () => {
      const { profile } = await register();
      await service.resendVerification(profile.id);
      expect(sent).toHaveLength(2);
      await service.verifyEmail(sent[0]!.token!);
      await service.resendVerification(profile.id);
      expect(sent).toHaveLength(2);
    });
  });

  describe('Google — customers', () => {
    it('creates a verified customer on first sign-in', async () => {
      const session = await service.loginWithGoogle(google({}), ctx);
      expect(session.profile).toMatchObject({
        email: 'sara@gmail.com',
        role: Role.CUSTOMER,
      });
      expect(users.rows[0]?.emailVerifiedAt).not.toBeNull();
    });

    it('refuses an unverified Google email', async () => {
      await expect(
        service.loginWithGoogle(google({ emailVerified: false }), ctx),
      ).rejects.toThrow(/verified email/);
    });

    it('removes a password someone set on an unverified account before the real owner arrived', async () => {
      const squatter = users.add({
        email: 'sara@gmail.com',
        role: Role.CUSTOMER,
        passwordHash: 'hash-set-by-attacker',
      });
      await service.loginWithGoogle(google({}), ctx);
      expect(squatter.passwordHash).toBeNull();
      expect(squatter.googleId).toBe('g-1');
      expect(audit.map((e) => e.action)).toContain(
        'auth.password_removed_on_google_link',
      );
    });

    it('keeps the password of an account whose email was already verified', async () => {
      const owner = users.add({
        email: 'sara@gmail.com',
        role: Role.CUSTOMER,
        passwordHash: 'own-hash',
        emailVerifiedAt: new Date(),
      });
      await service.loginWithGoogle(google({}), ctx);
      expect(owner.passwordHash).toBe('own-hash');
    });

    it('refuses a second Google account for an email that is already linked', async () => {
      users.add({
        email: 'sara@gmail.com',
        role: Role.CUSTOMER,
        googleId: 'g-original',
      });
      await expect(
        service.loginWithGoogle(google({ sub: 'g-other' }), ctx),
      ).rejects.toThrow(/different Google account/);
    });
  });

  describe('Google — Workspace staff', () => {
    const staffClaims = (over: Partial<GoogleClaims> = {}) =>
      google({
        sub: 'w-1',
        email: 'ali@forgea-lab.com',
        hostedDomain: 'forgea-lab.com',
        ...over,
      });

    it('signs in an existing staff member, links Google, and audits the sign-in', async () => {
      users.add({ email: 'ali@forgea-lab.com', role: Role.STAFF });
      const session = await service.loginWithGoogle(staffClaims(), ctx);
      expect(session.profile.role).toBe(Role.STAFF);
      expect(session.landingPath).toBe('/admin');
      expect(audit).toEqual([
        expect.objectContaining({
          action: 'auth.sign_in',
          ipAddress: '1.2.3.4',
        }),
      ]);
    });

    it('refuses a Workspace address that no admin has set up', async () => {
      await expect(service.loginWithGoogle(staffClaims(), ctx)).rejects.toThrow(
        /has not been set up/,
      );
      expect(users.rows).toHaveLength(0);
    });

    it('refuses a Workspace address without the hd claim (not managed by the organization)', async () => {
      users.add({ email: 'ali@forgea-lab.com', role: Role.STAFF });
      await expect(
        service.loginWithGoogle(staffClaims({ hostedDomain: undefined }), ctx),
      ).rejects.toThrow(/Workspace account/);
    });

    it('never turns a Workspace address into a customer', async () => {
      users.add({ email: 'ali@forgea-lab.com', role: Role.CUSTOMER });
      await expect(service.loginWithGoogle(staffClaims(), ctx)).rejects.toThrow(
        /not a staff account/,
      );
    });

    it('bootstraps the first admin from BOOTSTRAP_ADMIN_EMAIL, once', async () => {
      const first = await service.loginWithGoogle(
        staffClaims({ sub: 'w-owner', email: 'owner@forgea-lab.com' }),
        ctx,
      );
      expect(first.profile.role).toBe(Role.ADMIN);
      expect(audit.map((e) => e.action)).toContain('user.bootstrap_admin');

      // Another unprovisioned address is refused even though the bootstrap email is configured.
      await expect(
        service.loginWithGoogle(
          staffClaims({ sub: 'w-2', email: 'new@forgea-lab.com' }),
          ctx,
        ),
      ).rejects.toThrow(/has not been set up/);
    });

    it('refuses staff and admins on the customer path', async () => {
      users.add({
        email: 'boss@gmail.com',
        role: Role.ADMIN,
        googleId: 'g-boss',
      });
      await expect(
        service.loginWithGoogle(
          google({ sub: 'g-boss', email: 'boss@gmail.com' }),
          ctx,
        ),
      ).rejects.toThrow(/Workspace account/);
    });
  });
});
