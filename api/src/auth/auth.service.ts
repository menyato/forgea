import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PendingConfirmation, Profile } from '@forgea/types';
import type {
  ConfirmEmailDto,
  LoginDto,
  RegisterDto,
} from '@forgea/validation';
import { AccessTokenService } from '../authorization/access-token.service.js';
import { EmailVerificationTokens } from '../authorization/email-verification-tokens.js';
import { Notifications } from '../mail/notifications.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import type { EnvironmentVariables } from '../config/environment.js';
import type { User } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';
import { UsersRepository } from '../users/users.repository.js';
import { EmailCodes } from './email-codes.js';
import type { GoogleClaims } from './google-oidc.js';
import { PasswordHasher } from './password-hasher.js';
import type { RequestContext } from './request-context.js';
import { PasswordResetTokens } from '../authorization/password-reset-tokens.js';
import { TeamPermissions } from '../authorization/team-permissions.js';
import { LoginAttempts } from './login-attempts.js';
import { SessionService } from './session.service.js';

/** What the controller turns into cookies (and, for Google, a redirect). */
export interface IssuedSession {
  profile: Profile;
  accessToken: string;
  accessMaxAgeMs: number;
  refreshToken: string;
  /** Where the storefront should land after an OAuth sign-in. */
  /** Staff go to the dashboard; "customer" means: back to the page they came from. */
  landingPath: '/admin' | 'customer';
}

const INVALID_LOGIN = 'Email or password is incorrect';
const WRONG_CODE = 'That code is not right. Check the latest email from us.';
const ALREADY_CONFIRMED = 'This address is already confirmed. Sign in instead.';
const CODE_EXPIRED = 'This code has expired. Ask for a new one.';
/** New codes per address an hour, on top of the one-a-minute limit. */
const CODES_PER_HOUR = 6;

@Injectable()
export class AuthService {
  private readonly workspaceDomain: string;
  private readonly bootstrapAdminEmail: string | undefined;

  constructor(
    private readonly users: UsersRepository,
    private readonly passwords: PasswordHasher,
    private readonly sessions: SessionService,
    private readonly accessTokens: AccessTokenService,
    private readonly audit: AuditLogService,
    private readonly verification: EmailVerificationTokens,
    private readonly codes: EmailCodes,
    private readonly notifications: Notifications,
    private readonly attempts: LoginAttempts,
    private readonly resetTokens: PasswordResetTokens,
    private readonly team: TeamPermissions,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.workspaceDomain = config.get('WORKSPACE_DOMAIN', { infer: true });
    this.bootstrapAdminEmail = config
      .get('BOOTSTRAP_ADMIN_EMAIL', { infer: true })
      ?.toLowerCase();
  }

  /**
   * Customer sign-up with email + password. Staff addresses must use Google. Nobody is signed
   * in yet: a code goes to the address, and confirmEmail() signs them in once it is entered.
   */
  async register(dto: RegisterDto): Promise<PendingConfirmation> {
    if (this.isWorkspaceEmail(dto.email)) {
      throw new BadRequestException(
        `@${this.workspaceDomain} accounts sign in with Google`,
      );
    }
    if (await this.users.findByEmail(dto.email)) {
      // Reveals that the address is registered; rate limiting bounds probing.
      throw new ConflictException(
        'An account with this email already exists. Sign in instead.',
      );
    }
    const user = await this.users.createCustomer({
      email: dto.email,
      name: dto.name,
      passwordHash: await this.passwords.hash(dto.password),
    });
    return this.startConfirmation(user);
  }

  /**
   * Email + password sign-in, customers only. Every failure — unknown email, no password,
   * staff account, wrong password — gets the same message and takes the same time.
   */
  async loginWithPassword(
    dto: LoginDto,
    ctx: RequestContext,
  ): Promise<IssuedSession | PendingConfirmation> {
    this.attempts.check(dto.email, ctx.ip);
    const user = await this.users.findByEmail(dto.email);
    const ok =
      user?.passwordHash && user.role === Role.CUSTOMER
        ? await this.passwords.verify(user.passwordHash, dto.password)
        : await this.passwords.verifyNothing(dto.password);
    if (!ok || !user) {
      this.attempts.failed(dto.email, ctx.ip);
      throw new UnauthorizedException(INVALID_LOGIN);
    }
    this.attempts.succeeded(dto.email, ctx.ip);
    // A sign-up that never entered its code: the right password asks for a (new) code.
    if (!user.emailVerifiedAt) return this.startConfirmation(user);
    return this.issue(user, ctx);
  }

  /**
   * Google sign-in for everyone. Accounts on the Workspace domain may only be existing
   * ADMIN/STAFF users (2FA is enforced by Workspace); all other Google accounts are customers.
   */
  async loginWithGoogle(
    claims: GoogleClaims,
    ctx: RequestContext,
  ): Promise<IssuedSession> {
    if (!claims.email || !claims.emailVerified) {
      throw new ForbiddenException(
        'Your Google account has no verified email address',
      );
    }
    const email = claims.email.toLowerCase();
    const user = this.isWorkspaceEmail(email)
      ? await this.resolveStaff(claims, email, ctx)
      : await this.resolveCustomer(claims, email, ctx);
    return this.issue(user, ctx);
  }

  /** Exchanges the refresh cookie; the role is re-read so role changes apply at the next refresh. */
  async refresh(
    refreshToken: string,
    ctx: RequestContext,
  ): Promise<IssuedSession> {
    const { userId, token } = await this.sessions.rotate(refreshToken, ctx);
    const user = await this.users.findById(userId);
    if (!user || user.disabledAt) {
      throw new UnauthorizedException('Please sign in again');
    }
    return this.sign(user, token);
  }

  /**
   * The code from the email, with the ticket the browser kept: confirms the address and signs
   * the customer in. The ticket only names the account; without the code it does nothing.
   */
  async confirmEmail(
    dto: ConfirmEmailDto,
    ctx: RequestContext,
  ): Promise<IssuedSession> {
    const user = await this.ticketHolder(dto.ticket);
    // Already confirmed: the code is gone, and the ticket alone never signs anyone in.
    if (user.emailVerifiedAt) throw new BadRequestException(ALREADY_CONFIRMED);
    const check = await this.codes.check(user.id, dto.code);
    if (check === 'wrong') throw new BadRequestException(WRONG_CODE);
    if (check === 'expired') throw new BadRequestException(CODE_EXPIRED);
    return this.issue(await this.users.markEmailVerified(user.id), ctx);
  }

  /** A new code for the ticket's account; false when one went out less than a minute ago. */
  async resendEmailCode(ticket: string): Promise<{ sent: boolean }> {
    const user = await this.ticketHolder(ticket);
    if (user.emailVerifiedAt) return { sent: false };
    return { sent: await this.sendCode(user) };
  }

  /** The account a confirmation ticket names, while it still has that address. */
  private async ticketHolder(ticket: string): Promise<User> {
    const claims = await this.verification.verify(ticket);
    const user = claims && (await this.users.findById(claims.userId));
    if (!claims || !user || user.email !== claims.email || user.disabledAt) {
      throw new BadRequestException(
        'This page has expired. Sign in again to get a new code.',
      );
    }
    return user;
  }

  /** Emails a code and hands the browser the ticket that goes with it. */
  private async startConfirmation(user: User): Promise<PendingConfirmation> {
    await this.sendCode(user);
    return {
      ticket: await this.verification.issue(user.id, user.email),
      email: user.email,
    };
  }

  /** At most one code a minute (EmailCodes) and a few an hour per address. */
  private async sendCode(user: User): Promise<boolean> {
    // No new code (with its fresh tries) unless its email may go out: the hourly email cap
    // also caps guessing.
    if (
      !this.notifications.mayStillSend(
        `email-code:${user.email}`,
        CODES_PER_HOUR,
      )
    )
      return false;
    const code = await this.codes.issue(user.id);
    if (!code) return false;
    return this.notifications.sendAtMost(
      `email-code:${user.email}`,
      CODES_PER_HOUR,
      'emailCode',
      { to: user.email, code },
    );
  }

  /**
   * "Forgot your password?": emails a reset link to a customer account. The answer is the same
   * whether or not the address has an account, so nobody can probe which emails are customers.
   * Staff never have a password (they sign in with Google), so they get nothing.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || user.role !== Role.CUSTOMER || user.disabledAt) return;
    // At most 3 links an hour per address: nobody can flood someone's inbox with them.
    this.notifications.sendAtMost(
      `password-reset:${user.id}`,
      3,
      'passwordReset',
      {
        to: user.email,
        token: await this.resetTokens.issue(user.id, user.passwordHash),
      },
    );
  }

  /** Sets the password from a reset link; every session of the account ends. */
  async resetPassword(token: string, password: string): Promise<void> {
    const userId = await this.resetTokens.verify(token, async (id) => {
      const user = await this.users.findById(id);
      return user && user.role === Role.CUSTOMER && !user.disabledAt
        ? user.passwordHash
        : undefined;
    });
    if (!userId) {
      throw new BadRequestException(
        'This link has expired or was already used. Ask for a new one.',
      );
    }
    await this.users.setPassword(
      userId,
      await this.passwords.hash(password),
      true,
    );
  }

  /**
   * A signed-in customer changes their password (the current one proves it is them). Every
   * session ends, then this browser gets a fresh one so it stays signed in.
   */
  async changePassword(
    userId: string,
    current: string,
    next: string,
    ctx: RequestContext,
  ): Promise<IssuedSession> {
    const user = await this.users.findById(userId);
    if (!user || user.role !== Role.CUSTOMER) throw new UnauthorizedException();
    if (!user.passwordHash) {
      throw new BadRequestException(
        'This account signs in with Google. To add a password, use "Forgot your password?".',
      );
    }
    if (!(await this.passwords.verify(user.passwordHash, current))) {
      throw new BadRequestException('Your current password is not right');
    }
    const updated = await this.users.setPassword(
      user.id,
      await this.passwords.hash(next),
      false,
    );
    return this.issue(updated, ctx);
  }

  /** The account page: name and phone (used for orders and delivery calls). */
  async updateProfile(
    userId: string,
    contact: { name: string; phone: string },
  ): Promise<Profile> {
    return this.toProfile(await this.users.updateContact(userId, contact));
  }

  logout(refreshToken: string): Promise<void> {
    return this.sessions.end(refreshToken);
  }

  async profile(userId: string): Promise<Profile> {
    const user = await this.users.findById(userId);
    // A switched-off team member's last access token is refused here too, so the dashboard
    // closes for them at once (other API calls end when that token expires, ≤ 15 minutes).
    if (!user || user.disabledAt) throw new UnauthorizedException();
    return this.toProfile(user);
  }

  private async resolveStaff(
    claims: GoogleClaims,
    email: string,
    ctx: RequestContext,
  ): Promise<User> {
    // `hd` is only set for accounts managed by the Workspace organization itself.
    if (claims.hostedDomain !== this.workspaceDomain) {
      throw new ForbiddenException(
        `Sign in with your ${this.workspaceDomain} Workspace account`,
      );
    }
    const existing =
      (await this.users.findByGoogleId(claims.sub)) ??
      (await this.users.findByEmail(email));

    if (!existing) {
      if (
        email === this.bootstrapAdminEmail &&
        !(await this.users.adminExists())
      ) {
        const admin = await this.users.createBootstrapAdmin({
          email,
          name: claims.name,
          googleId: claims.sub,
        });
        await this.audit.record({
          actorUserId: admin.id,
          action: 'user.bootstrap_admin',
          targetType: 'User',
          targetId: admin.id,
          ipAddress: ctx.ip,
        });
        return admin;
      }
      throw new ForbiddenException(
        'Your staff account has not been set up. Ask an admin.',
      );
    }
    if (existing.role === Role.CUSTOMER) {
      throw new ForbiddenException(
        'This address is not a staff account. Ask an admin.',
      );
    }
    if (existing.disabledAt) {
      throw new ForbiddenException(
        'Your access has been switched off. Ask an admin.',
      );
    }
    return this.ensureGoogleLinked(existing, claims.sub);
  }

  private async resolveCustomer(
    claims: GoogleClaims,
    email: string,
    ctx: RequestContext,
  ): Promise<User> {
    const byGoogle = await this.users.findByGoogleId(claims.sub);
    if (byGoogle) {
      if (byGoogle.role !== Role.CUSTOMER)
        throw new ForbiddenException('Use your Workspace account');
      return byGoogle;
    }
    const byEmail = await this.users.findByEmail(email);
    if (!byEmail) {
      return this.users.createCustomer({
        email,
        name: claims.name,
        googleId: claims.sub,
        emailVerifiedAt: new Date(),
      });
    }
    if (byEmail.role !== Role.CUSTOMER)
      throw new ForbiddenException('Use your Workspace account');

    const hadPassword = byEmail.passwordHash !== null;
    const linked = await this.ensureGoogleLinked(byEmail, claims.sub);
    if (hadPassword && linked.passwordHash === null) {
      await this.audit.record({
        actorUserId: linked.id,
        action: 'auth.password_removed_on_google_link',
        targetType: 'User',
        targetId: linked.id,
        ipAddress: ctx.ip,
      });
    }
    return linked;
  }

  /** Links on first Google sign-in; refuses a different Google account for the same email. */
  private async ensureGoogleLinked(user: User, sub: string): Promise<User> {
    if (user.googleId === sub) return user;
    if (user.googleId !== null) {
      throw new ForbiddenException(
        'This email is linked to a different Google account',
      );
    }
    return this.users.linkGoogle(user, sub);
  }

  private async issue(user: User, ctx: RequestContext): Promise<IssuedSession> {
    const refreshToken = await this.sessions.start(user.id, ctx);
    if (user.role !== Role.CUSTOMER) {
      await this.audit.record({
        actorUserId: user.id,
        action: 'auth.sign_in',
        targetType: 'User',
        targetId: user.id,
        ipAddress: ctx.ip,
      });
    }
    return this.sign(user, refreshToken);
  }

  private async sign(user: User, refreshToken: string): Promise<IssuedSession> {
    return {
      profile: await this.toProfile(user),
      accessToken: await this.accessTokens.sign({
        id: user.id,
        role: user.role,
      }),
      accessMaxAgeMs: this.accessTokens.maxAgeMs,
      refreshToken,
      landingPath: user.role === Role.CUSTOMER ? 'customer' : '/admin',
    };
  }

  private isWorkspaceEmail(email: string): boolean {
    return email.endsWith(`@${this.workspaceDomain}`);
  }

  private async toProfile(user: User): Promise<Profile> {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
      emailVerified: user.emailVerifiedAt !== null,
      hasPassword: user.passwordHash !== null,
      permissions: await this.team.of(user),
    };
  }
}
