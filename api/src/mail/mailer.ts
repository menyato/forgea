import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import { GoogleServiceAccount } from '../google/google-service-account.js';

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const GMAIL_SEND =
  'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

/** Header values: no line breaks (header injection), non-ASCII as RFC 2047 words. */
function header(value: string): string {
  const flat = value.replace(/[\r\n]+/g, ' ').trim();
  return /^[\x20-\x7e]*$/.test(flat)
    ? flat
    : `=?UTF-8?B?${Buffer.from(flat).toString('base64')}?=`;
}

/** The email as an RFC 5322 message with a plain-text and an HTML part. */
export function toMime(email: Email, from: string, now = new Date()): string {
  const boundary = `forgea-${randomUUID()}`;
  const part = (type: string, body: string) =>
    [
      `--${boundary}`,
      `Content-Type: ${type}; charset=UTF-8`,
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(body).toString('base64').replace(/.{76}/g, '$&\r\n'),
    ].join('\r\n');
  return [
    `From: Forgea <${header(from)}>`,
    `To: ${header(email.to)}`,
    `Subject: ${header(email.subject)}`,
    `Date: ${now.toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    part('text/plain', email.text),
    part('text/html', email.html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/** Sends one email. Callers never wait on it for their own result (see Notifications). */
export abstract class Mailer {
  abstract send(email: Email): Promise<void>;
}

/** Production: the Gmail API as the studio's Workspace address (no password stored). */
@Injectable()
export class GmailMailer extends Mailer {
  /** Replaced in tests. */
  protected fetchImpl: typeof fetch = (input, init) => fetch(input, init);
  private readonly from: string;

  constructor(
    private readonly google: GoogleServiceAccount,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    super();
    this.from =
      config.get('MAIL_FROM', { infer: true }) ??
      config.get('MAIL_SENDER', { infer: true }) ??
      '';
  }

  async send(email: Email): Promise<void> {
    const token = await this.google.accessToken(GMAIL_SCOPE);
    const res = await this.fetchImpl(GMAIL_SEND, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        raw: Buffer.from(toMime(email, this.from)).toString('base64url'),
      }),
    });
    if (!res.ok) throw new Error(`Gmail refused the email (${res.status})`);
  }
}

/**
 * Development and tests: each email becomes an .eml file in MAIL_OUTBOX_DIR (open it with any
 * mail program). Nothing leaves the machine.
 */
@Injectable()
export class OutboxMailer extends Mailer {
  private readonly logger = new Logger('Outbox');
  private readonly dir: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super();
    this.dir = resolve(config.get('MAIL_OUTBOX_DIR', { infer: true }));
  }

  async send(email: Email): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.eml`;
    await writeFile(join(this.dir, name), toMime(email, 'outbox@localhost'));
    this.logger.log(`"${email.subject}" to ${email.to} → ${name}`);
  }
}
