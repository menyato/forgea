import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { EnvironmentVariables } from '../config/environment.js';
import { Role } from '../generated/prisma/enums.js';
import type { AuthenticatedUser } from './authenticated-user.js';

const ISSUER = 'forgea-api';
const AUDIENCE = 'forgea';
const ROLES = new Set<string>(Object.values(Role));

interface AccessClaims {
  sub: string;
  role: string;
}

/**
 * Short-lived JWT proving who the caller is. HS256 only — the algorithm is pinned on
 * verification so a token can't choose a weaker one ("alg: none" attacks).
 */
@Injectable()
export class AccessTokenService {
  private readonly ttlSeconds: number;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.ttlSeconds = config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true });
  }

  get maxAgeMs(): number {
    return this.ttlSeconds * 1000;
  }

  sign(user: AuthenticatedUser): Promise<string> {
    const claims: AccessClaims = { sub: user.id, role: user.role };
    return this.jwt.signAsync(claims, {
      algorithm: 'HS256',
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: this.ttlSeconds,
    });
  }

  /** The user, or null for any invalid, expired or tampered token. */
  async verify(token: string): Promise<AuthenticatedUser | null> {
    try {
      const claims = await this.jwt.verifyAsync<AccessClaims>(token, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      if (typeof claims.sub !== 'string' || !ROLES.has(claims.role))
        return null;
      return { id: claims.sub, role: claims.role as Role };
    } catch {
      return null;
    }
  }
}
