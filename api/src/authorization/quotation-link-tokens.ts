import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

const ISSUER = 'forgea-api';
/** Its own audience: never accepted as a sign-in, verification or reset token, nor they as it. */
const AUDIENCE = 'forgea-quotation';
/** Still readable this long after the quotation's last valid day (accepting it is refused). */
const GRACE_SECONDS = 60 * 86_400;

/**
 * The link in the quotation email: opens that one quotation without an account. It names the
 * address it was sent to, so editing the quotation to another address retires the old link.
 */
@Injectable()
export class QuotationLinkTokens {
  constructor(private readonly jwt: JwtService) {}

  issue(quotationId: string, email: string, validUntil: Date): Promise<string> {
    const seconds = Math.max(
      86_400,
      Math.round((validUntil.getTime() - Date.now()) / 1000) + GRACE_SECONDS,
    );
    return this.jwt.signAsync(
      { sub: quotationId, email },
      {
        algorithm: 'HS256',
        issuer: ISSUER,
        audience: AUDIENCE,
        expiresIn: seconds,
      },
    );
  }

  /** The quotation and the address it was sent to; null for any invalid or expired link. */
  async verify(
    token: string,
  ): Promise<{ quotationId: string; email: string } | null> {
    try {
      const claims = await this.jwt.verifyAsync<{
        sub: unknown;
        email: unknown;
      }>(token, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
      return typeof claims.sub === 'string' && typeof claims.email === 'string'
        ? { quotationId: claims.sub, email: claims.email }
        : null;
    } catch {
      return null;
    }
  }
}
