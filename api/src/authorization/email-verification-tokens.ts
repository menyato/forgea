import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

const ISSUER = 'forgea-api';
/** A different audience from sign-in tokens: one can never be used as the other. */
const AUDIENCE = 'forgea-confirm-email';
const VALID_SECONDS = 15 * 60;

/**
 * The confirmation ticket the browser holds between sign-up and entering the emailed code:
 * names the account and its address (a changed address needs a new one), for 15 minutes. It
 * signs nobody in by itself: only together with the code (EmailCodes).
 */
@Injectable()
export class EmailVerificationTokens {
  constructor(private readonly jwt: JwtService) {}

  issue(userId: string, email: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, email },
      {
        algorithm: 'HS256',
        issuer: ISSUER,
        audience: AUDIENCE,
        expiresIn: VALID_SECONDS,
      },
    );
  }

  /** The user and address it was issued for, or null for any invalid or expired link. */
  async verify(
    token: string,
  ): Promise<{ userId: string; email: string } | null> {
    try {
      const claims = await this.jwt.verifyAsync<{
        sub: unknown;
        email: unknown;
      }>(token, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
      return typeof claims.sub === 'string' && typeof claims.email === 'string'
        ? { userId: claims.sub, email: claims.email }
        : null;
    } catch {
      return null;
    }
  }
}
