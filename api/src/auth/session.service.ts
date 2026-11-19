import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import type { RequestContext } from './request-context.js';
import { type NewSession, SessionsRepository } from './sessions.repository.js';

/** 256 bits of randomness; the token is opaque and never stored, only its hash. */
const TOKEN_BYTES = 32;
/**
 * A token rotated less than this long ago, sent again by the same browser, is two tabs (or
 * a page and its data request) refreshing together, not a thief: it gets a session too.
 */
const ROTATION_GRACE_MS = 20_000;

export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/**
 * Refresh-token sessions with rotation and reuse detection (OAuth 2.0 Security BCP §4.14):
 * each refresh issues a new token and revokes the old one; presenting a revoked token
 * revokes every token from that login, because only a thief would hold an old one, except
 * the same browser within a few seconds of the rotation (two tabs refreshing together).
 */
@Injectable()
export class SessionService {
  private readonly ttlMs: number;

  constructor(
    private readonly sessions: SessionsRepository,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.ttlMs =
      config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000;
  }

  /** Starts a new login; returns the refresh token for the cookie. */
  async start(userId: string, ctx: RequestContext): Promise<string> {
    const { token, session } = this.newSession(userId, randomUUID(), ctx);
    await this.sessions.create(session);
    return token;
  }

  /** Exchanges a refresh token for a new one. */
  async rotate(
    token: string,
    ctx: RequestContext,
  ): Promise<{ userId: string; token: string }> {
    const current = await this.sessions.findByTokenHash(hashToken(token));
    if (!current) throw new UnauthorizedException('Please sign in again');

    if (current.revokedAt !== null) {
      const sibling = await this.graceSibling(current, ctx);
      if (sibling) return sibling;
      await this.sessions.revokeFamily(current.familyId);
      throw new UnauthorizedException('Please sign in again');
    }
    if (current.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Please sign in again');
    }

    const next = this.newSession(current.userId, current.familyId, ctx);
    if (!(await this.sessions.rotate(current.id, next.session))) {
      // Another request rotated this token a moment ago: the same browser's other tab.
      const again = await this.sessions.findByTokenHash(hashToken(token));
      const sibling = again ? await this.graceSibling(again, ctx) : null;
      if (sibling) return sibling;
      await this.sessions.revokeFamily(current.familyId);
      throw new UnauthorizedException('Please sign in again');
    }
    return { userId: current.userId, token: next.token };
  }

  /**
   * A sibling session for a token just rotated by the same browser (same user agent and
   * address): one, once, so a copied token replayed in that moment gains nothing more; null
   * otherwise.
   */
  private async graceSibling(
    current: {
      id: string;
      userId: string;
      familyId: string;
      rotatedAt: Date | null;
      userAgent: string | null;
      ipAddress: string | null;
    },
    ctx: RequestContext,
  ): Promise<{ userId: string; token: string } | null> {
    const recent =
      current.rotatedAt !== null &&
      Date.now() - current.rotatedAt.getTime() < ROTATION_GRACE_MS &&
      current.userAgent === ctx.userAgent &&
      // Where both addresses are known they must be the same.
      (current.ipAddress === null ||
        ctx.ip === null ||
        current.ipAddress === ctx.ip);
    if (!recent) return null;
    const next = this.newSession(current.userId, current.familyId, ctx);
    if (
      !(await this.sessions.sibling(current.id, current.familyId, next.session))
    )
      return null;
    return { userId: current.userId, token: next.token };
  }

  async end(token: string): Promise<void> {
    await this.sessions.revokeByTokenHash(hashToken(token));
  }

  private newSession(userId: string, familyId: string, ctx: RequestContext) {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const session: NewSession = {
      userId,
      familyId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + this.ttlMs),
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    };
    return { token, session };
  }
}
