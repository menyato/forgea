import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import type { Session } from '../generated/prisma/client.js';
import { hashToken, SessionService } from './session.service.js';
import type { NewSession, SessionsRepository } from './sessions.repository.js';

class FakeSessions {
  rows: Session[] = [];
  private seq = 0;
  private insert(s: NewSession) {
    this.rows.push({
      ...s,
      id: `s${++this.seq}`,
      revokedAt: null,
      createdAt: new Date(),
    });
  }
  findByTokenHash = async (h: string) =>
    this.rows.find((s) => s.tokenHash === h) ?? null;
  create = async (s: NewSession) => this.insert(s);
  rotate = async (oldId: string, next: NewSession) => {
    const old = this.rows.find((s) => s.id === oldId);
    if (!old || old.revokedAt) return false;
    old.revokedAt = new Date();
    this.insert(next);
    return true;
  };
  revokeByTokenHash = async (h: string) => {
    for (const s of this.rows)
      if (s.tokenHash === h) s.revokedAt ??= new Date();
  };
  revokeFamily = async (f: string) => {
    for (const s of this.rows) if (s.familyId === f) s.revokedAt ??= new Date();
  };
}

const config = new ConfigService({
  REFRESH_TOKEN_TTL_DAYS: 30,
}) as ConfigService<EnvironmentVariables, true>;
const ctx = { ip: null, userAgent: null };

describe('SessionService', () => {
  let repo: FakeSessions;
  let service: SessionService;

  beforeEach(() => {
    repo = new FakeSessions();
    service = new SessionService(repo as unknown as SessionsRepository, config);
  });

  it('stores only a hash of the token', async () => {
    const token = await service.start('u1', ctx);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(repo.rows[0]?.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(repo.rows)).not.toContain(token);
  });

  it('rotates: the new token works, the old one no longer does', async () => {
    const first = await service.start('u1', ctx);
    const { userId, token: second } = await service.rotate(first, ctx);
    expect(userId).toBe('u1');
    await expect(service.rotate(second, ctx)).resolves.toMatchObject({
      userId: 'u1',
    });
  });

  it('on reuse of a revoked token, revokes every token of that login', async () => {
    const first = await service.start('u1', ctx);
    const { token: second } = await service.rotate(first, ctx);
    await expect(service.rotate(first, ctx)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(service.rotate(second, ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("leaves the user's other logins alone", async () => {
    const phone = await service.start('u1', ctx);
    const laptop = await service.start('u1', ctx);
    const { token: phone2 } = await service.rotate(phone, ctx);
    await expect(service.rotate(phone, ctx)).rejects.toThrow(); // phone family revoked
    await expect(service.rotate(laptop, ctx)).resolves.toBeDefined();
    await expect(service.rotate(phone2, ctx)).rejects.toThrow();
  });

  it('refuses an expired token', async () => {
    const token = await service.start('u1', ctx);
    repo.rows[0]!.expiresAt = new Date(Date.now() - 1);
    await expect(service.rotate(token, ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('refuses an unknown token', async () => {
    await expect(service.rotate('not-a-real-token', ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('end() revokes the token', async () => {
    const token = await service.start('u1', ctx);
    await service.end(token);
    await expect(service.rotate(token, ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
