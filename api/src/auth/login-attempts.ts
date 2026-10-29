import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { throttleKey } from '../security/throttle-policies.js';

/** Wrong passwords for one account from one address (an IPv6 /64), per hour. */
const PER_SENDER = 10;
/** Wrong passwords for one account from every address together, per hour. */
const PER_ACCOUNT = 200;
const WINDOW_MS = 60 * 60 * 1000;
/** Counters kept at once; the oldest goes first. */
const MAX_TRACKED = 50_000;

/**
 * Wrong passwords per account. Counted per account AND sender, so a stranger's guesses never
 * lock out the account's owner (who signs in from elsewhere); and per account from everyone,
 * with a ceiling high enough that only a large guessing campaign reaches it (and each
 * address is already limited to a few sign-in attempts a minute). Kept in memory: one API
 * per environment.
 */
@Injectable()
export class LoginAttempts {
  private readonly failures = new Map<
    string,
    { count: number; since: number }
  >();

  /** Throws 429 when this account had too many wrong passwords lately, from here or overall. */
  check(email: string, ip: string | null): void {
    if (
      this.count(senderKey(email, ip)) >= PER_SENDER ||
      this.count(accountKey(email)) >= PER_ACCOUNT
    ) {
      throw new HttpException(
        'Too many wrong passwords for this account. Try again in an hour, or continue with Google.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  failed(email: string, ip: string | null): void {
    this.add(senderKey(email, ip));
    this.add(accountKey(email));
  }

  /** A successful sign-in (or a new password) clears this account's counters from here. */
  succeeded(email: string, ip: string | null): void {
    this.failures.delete(senderKey(email, ip));
  }

  private count(key: string): number {
    const entry = this.failures.get(key);
    if (entry && Date.now() - entry.since > WINDOW_MS) {
      this.failures.delete(key);
      return 0;
    }
    return entry?.count ?? 0;
  }

  private add(key: string): void {
    const count = this.count(key);
    const since = this.failures.get(key)?.since ?? Date.now();
    this.failures.delete(key);
    if (this.failures.size >= MAX_TRACKED) {
      this.failures.delete(this.failures.keys().next().value!);
    }
    this.failures.set(key, { count: count + 1, since });
  }
}

const accountKey = (email: string) => `account:${email}`;
const senderKey = (email: string, ip: string | null) =>
  `sender:${email}:${ip ? throttleKey(ip) : 'unknown'}`;
