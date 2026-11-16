import { createSign } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Refresh a little before Google's one-hour expiry. */
const EARLY_MS = 60_000;

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

const base64url = (data: string | Buffer) =>
  Buffer.from(data).toString('base64url');

/**
 * Access tokens for Google APIs (Gmail, Calendar) from the service account key, acting as the
 * studio's Workspace address through domain-wide delegation. The signed request (a JWT) is
 * built here with Node's crypto, so no Google client library is needed; tokens are cached per
 * scope until shortly before they expire.
 */
@Injectable()
export class GoogleServiceAccount {
  private readonly key: ServiceAccountKey | null;
  private readonly subject: string | null;
  private readonly tokens = new Map<string, { token: string; until: number }>();
  /** Replaced in tests. */
  protected fetchImpl: typeof fetch = (input, init) => fetch(input, init);

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const raw = config.get('GOOGLE_SERVICE_ACCOUNT_KEY', { infer: true });
    this.key = raw ? (JSON.parse(raw) as ServiceAccountKey) : null;
    this.subject = config.get('MAIL_SENDER', { infer: true }) ?? null;
  }

  /** False in development and tests: nothing is sent to Google. */
  get configured(): boolean {
    return this.key !== null && this.subject !== null;
  }

  async accessToken(scope: string, now = Date.now()): Promise<string> {
    if (!this.key || !this.subject) {
      throw new Error('The Google service account is not configured');
    }
    const cached = this.tokens.get(scope);
    if (cached && cached.until > now) return cached.token;

    const issued = Math.floor(now / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(
      JSON.stringify({
        iss: this.key.client_email,
        sub: this.subject,
        scope,
        aud: TOKEN_URL,
        iat: issued,
        exp: issued + 3600,
      }),
    );
    const signature = createSign('RSA-SHA256')
      .update(`${header}.${claims}`)
      .sign(this.key.private_key, 'base64url');

    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      // Email and calendar wait on this: a stalled connection must not hold them open.
      signal: AbortSignal.timeout(8_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${header}.${claims}.${signature}`,
      }),
    });
    if (!res.ok) {
      throw new Error(`Google refused the service account (${res.status})`);
    }
    const body = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.tokens.set(scope, {
      token: body.access_token,
      until: now + body.expires_in * 1000 - EARLY_MS,
    });
    return body.access_token;
  }
}
