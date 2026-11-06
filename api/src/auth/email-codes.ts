import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import { PrismaService } from '../database/prisma.service.js';

const VALID_MS = 10 * 60 * 1000;
const TRIES = 5;
/**
 * Wrong codes an account may ever get: a code a minute with five tries each would otherwise
 * let someone guess a 6-digit code over a few weeks. Past it, the owner of the address
 * confirms it by resetting the password from the emailed link.
 */
const LIFETIME_WRONG = 20;
/** A new code is sent at most this often for one account. */
const RESEND_AFTER_MS = 60 * 1000;

export type CodeCheck = 'ok' | 'wrong' | 'expired';

/**
 * The 6-digit codes that confirm a new account's address. One live code per account (a new
 * one replaces the last); stored as an HMAC keyed with a server secret, so the table alone
 * can't be used to guess them; five wrong tries or ten minutes and it stops working.
 */
@Injectable()
export class EmailCodes {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    // Its own key, derived from the token secret: a code hash can't be confused with a token.
    this.key = createHmac(
      'sha256',
      config.get('JWT_ACCESS_SECRET', { infer: true }),
    )
      .update('forgea-email-code')
      .digest();
  }

  /** A new code for the account (replacing any earlier one), or null if one went out within the last minute. */
  async issue(userId: string, now = new Date()): Promise<string | null> {
    const last = await this.prisma.emailCode.findUnique({
      where: { userId },
      select: { sentAt: true, wrongTotal: true },
    });
    if (last && now.getTime() - last.sentAt.getTime() < RESEND_AFTER_MS)
      return null;
    if (last && last.wrongTotal >= LIFETIME_WRONG) return null;
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const row = {
      codeHash: this.hash(userId, code),
      expiresAt: new Date(now.getTime() + VALID_MS),
      attemptsLeft: TRIES,
      sentAt: now,
    };
    await this.prisma.emailCode.upsert({
      where: { userId },
      create: { userId, ...row },
      update: row,
    });
    return code;
  }

  /** Checks a code; the right one is used up, a wrong one costs a try. */
  async check(
    userId: string,
    code: string,
    now = new Date(),
  ): Promise<CodeCheck> {
    return this.prisma.$transaction(async (tx) => {
      // Locked, so two guesses at once can't both spend the same try.
      const [row] = await tx.$queryRaw<
        {
          codeHash: string;
          expiresAt: Date;
          attemptsLeft: number;
          wrongTotal: number;
        }[]
      >`SELECT "codeHash", "expiresAt", "attemptsLeft", "wrongTotal" FROM email_codes WHERE "userId" = ${userId}::uuid FOR UPDATE`;
      if (
        !row ||
        row.expiresAt <= now ||
        row.attemptsLeft <= 0 ||
        row.wrongTotal >= LIFETIME_WRONG
      )
        return 'expired';
      const given = Buffer.from(this.hash(userId, code), 'hex');
      const stored = Buffer.from(row.codeHash, 'hex');
      if (given.length === stored.length && timingSafeEqual(given, stored)) {
        await tx.emailCode.delete({ where: { userId } });
        return 'ok';
      }
      await tx.emailCode.update({
        where: { userId },
        data: {
          attemptsLeft: { decrement: 1 },
          wrongTotal: { increment: 1 },
        },
      });
      return row.attemptsLeft - 1 > 0 && row.wrongTotal + 1 < LIFETIME_WRONG
        ? 'wrong'
        : 'expired';
    });
  }

  private hash(userId: string, code: string): string {
    return createHmac('sha256', this.key)
      .update(`${userId}:${code}`)
      .digest('hex');
  }
}
