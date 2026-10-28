import {
  type ExecutionContext,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard, type AuthGuardAuthenticateOptions } from '@nestjs/passport';
import * as oidc from 'openid-client';
import { Strategy } from 'openid-client/passport';
import passport from 'passport';
import { safeNext } from '@forgea/types';
import type { Request } from 'express';
import type { EnvironmentVariables } from '../config/environment.js';

const GOOGLE_STRATEGY = 'google';
const GOOGLE_ISSUER = new URL('https://accounts.google.com');

/** The ID-token claims we rely on. Signature, issuer, audience and nonce are verified by openid-client. */
export interface GoogleClaims {
  sub: string;
  email: string | undefined;
  emailVerified: boolean;
  /** Google Workspace domain; absent for personal Google accounts. */
  hostedDomain: string | undefined;
  name: string | undefined;
}

/** The safe same-site path saved when Google sign-in started; "/" if none. */
export function googleReturnPath(req: Request): string {
  const next: unknown = req.session?.['next'];
  return safeNext(typeof next === 'string' ? next : null);
}

export function parseGoogleClaims(raw: unknown): GoogleClaims | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c['sub'] !== 'string' || c['sub'].length === 0) return null;
  const str = (v: unknown) =>
    typeof v === 'string' && v.length > 0 ? v : undefined;
  return {
    sub: c['sub'],
    email: str(c['email']),
    emailVerified: c['email_verified'] === true,
    hostedDomain: str(c['hd']),
    name: str(c['name']),
  };
}

/**
 * Registers the Google OpenID Connect strategy with Passport at startup (authorization
 * code flow with PKCE, state and nonce). Disabled when no client credentials are set.
 */
@Injectable()
export class GoogleOidc implements OnModuleInit {
  private readonly logger = new Logger(GoogleOidc.name);
  enabled = false;

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    const clientId = this.config.get('GOOGLE_CLIENT_ID', { infer: true });
    const clientSecret = this.config.get('GOOGLE_CLIENT_SECRET', {
      infer: true,
    });
    if (!clientId || !clientSecret) {
      this.logger.warn(
        'Google sign-in disabled: GOOGLE_CLIENT_ID/SECRET not set',
      );
      return;
    }
    const discovered = await oidc.discovery(
      GOOGLE_ISSUER,
      clientId,
      clientSecret,
    );
    const callbackURL = new URL(
      '/auth/google/callback',
      this.config.get('PUBLIC_API_URL', { infer: true }),
    );
    passport.use(
      GOOGLE_STRATEGY,
      new Strategy(
        { config: discovered, scope: 'openid email profile', callbackURL },
        (tokens, done) =>
          // Hand the verified claims to the controller; AuthService decides who they are.
          done(null, tokens.claims() as unknown as Express.User),
      ),
    );
    this.enabled = true;
  }
}

/**
 * Starts the Google redirect, and on the callback puts the verified claims on
 * `req.googleClaims` (not `req.user`, which only ever holds our own signed-in user).
 */
@Injectable()
export class GoogleAuthGuard extends AuthGuard(GOOGLE_STRATEGY) {
  constructor(private readonly google: GoogleOidc) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    if (!this.google.enabled)
      throw new NotFoundException('Google sign-in is not configured');
    const req = context.switchToHttp().getRequest<Request>();
    // Starting (not the callback): remember where the shopper was, e.g. /checkout.
    if (req.path === '/auth/google' && req.session) {
      const next = req.query['next'];
      req.session['next'] = safeNext(typeof next === 'string' ? next : null);
    }
    return super.canActivate(context);
  }

  override getAuthenticateOptions(
    _context: ExecutionContext,
  ): AuthGuardAuthenticateOptions {
    return {
      session: false,
      property: 'googleClaims',
      prompt: 'select_account',
    };
  }
}
