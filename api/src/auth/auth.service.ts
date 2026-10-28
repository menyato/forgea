import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Profile } from '@forgea/types';
import type { LoginDto, RegisterDto } from '@forgea/validation';
import { AccessTokenService } from '../authorization/access-token.service.js';
import { EmailVerificationTokens } from '../authorization/email-verification-tokens.js';
import { Notifications } from '../mail/notifications.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import type { EnvironmentVariables } from '../config/environment.js';
import type { User } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';
import { UsersRepository } from '../users/users.repository.js';
import type { GoogleClaims } from './google-oidc.js';
import { PasswordHasher } from './password-hasher.js';
import type { RequestContext } from './request-context.js';
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
    private readonly notifications: Notifications,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.workspaceDomain = config.get('WORKSPACE_DOMAIN', { infer: true });
    this.bootstrapAdminEmail = config
      .get('BOOTSTRAP_ADMIN_EMAIL', { infer: true })
      ?.toLowerCase();
  }

  /** Customer sign-up with email + password. Staff addresses must use Google. */
  async register(
    dto: RegisterDto,
    ctx: RequestContext,
  ): Promise<IssuedSession> {
    if (this.isWorkspaceEmail(dto.email)) {
      throw new BadRequestException(
        `@${this.workspaceDomain} accounts sign in with Google`,
      );
    }
    if (await this.users.findByEmail(dto.email)) {
      // Reveals that the address is registered; rate limiting bounds probing.
      // Phase 9 replaces this with an emailed verification link (no difference in response).
      throw new ConflictException(
        'An account with this email already exists. Sign in instead.',
      );
    }
    const user = await this.users.createCustomer({
      email: dto.email,
      name: dto.name,
      passwordHash: await this.passwords.hash(dto.password),
    });
    await this.sendVerification(user);
    return this.issue(user, ctx);
  }

  /**
   * Email + password sign-in, customers only. Every failure — unknown email, no password,
   * staff account, wrong password — gets the same message and takes the same time.
   */
  async loginWithPassword(
    dto: LoginDto,
    ctx: RequestContext,
  ): Promise<IssuedSession> {
    const user = await this.users.findByEmail(dto.email);
    const ok =
      user?.passwordHash && user.role === Role.CUSTOMER
        ? await this.passwords.verify(user.passwordHash, dto.password)
        : await this.passwords.verifyNothing(dto.password);
    if (!ok || !user) throw new UnauthorizedException(INVALID_LOGIN);
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

  /** Confirms the address the link was sent to (only if the account still has that address). */
  async verifyEmail(token: string): Promise<Profile> {
    const claims = await this.verification.verify(token);
    const user = claims && (await this.users.findById(claims.userId));
    if (!claims || !user || user.email !== claims.email) {
      throw new BadRequestException(
        'This link has expired or is not valid. Ask for a new one from your account.',
      );
    }
    return toProfile(
      user.emailVerifiedAt ? user : await this.users.markEmailVerified(user.id),
    );
  }

  /** Sends a new link; nothing happens for an address that is already confirmed. */
  async resendVerification(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (user && !user.emailVerifiedAt) await this.sendVerification(user);
  }

  private async sendVerification(user: User): Promise<void> {
    this.notifications.send('verifyEmail', {
      to: user.email,
      token: await this.verification.issue(user.id, user.email),
    });
  }

  logout(refreshToken: string): Promise<void> {
    return this.sessions.end(refreshToken);
  }

  async profile(userId: string): Promise<Profile> {
    const user = await this.users.findById(userId);
    // A switched-off team member's last access token is refused here too, so the dashboard
    // closes for them at once (other API calls end when that token expires, ≤ 15 minutes).
    if (!user || user.disabledAt) throw new UnauthorizedException();
    return toProfile(user);
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
      profile: toProfile(user),
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
}

function toProfile(user: User): Profile {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    role: user.role,
  };
}
