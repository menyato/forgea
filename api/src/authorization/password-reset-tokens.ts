import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

const ISSUER = 'forgea-api';
/** Its own audience: never accepted as a sign-in or email-verification token, nor they as it. */
const AUDIENCE = 'forgea-password-reset';
const VALID_SECONDS = 30 * 60;

/**
 * The link in the "choose a new password" email: for one account, for 30 minutes, and only
 * while the password is still the one it was issued for, so it works once (setting the new
 * password changes it) and dies if the password changes another way meanwhile.
 */
@Injectable()
export class PasswordResetTokens {
  constructor(private readonly jwt: JwtService) {}

  issue(userId: string, passwordHash: string | null): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, pwd: fingerprint(passwordHash) },
      {
        algorithm: 'HS256',
        issuer: ISSUER,
        audience: AUDIENCE,
        expiresIn: VALID_SECONDS,
      },
    );
  }

  /** The account it was issued for, if it is valid for this current password; else null. */
  async verify(
    token: string,
    currentHash: (userId: string) => Promise<string | null | undefined>,
  ): Promise<string | null> {
    try {
      const claims = await this.jwt.verifyAsync<{ sub: unknown; pwd: unknown }>(
        token,
        { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE },
      );
      if (typeof claims.sub !== 'string') return null;
      const hash = await currentHash(claims.sub);
      return hash !== undefined && claims.pwd === fingerprint(hash)
        ? claims.sub
        : null;
    } catch {
      return null;
    }
  }
}

/** A short, one-way stand-in for the password hash (the hash itself never leaves the API). */
function fingerprint(passwordHash: string | null): string {
  return createHash('sha256')
    .update(passwordHash ?? 'no-password')
    .digest('base64url')
    .slice(0, 16);
}
