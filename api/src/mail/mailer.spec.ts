import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import type { EnvironmentVariables } from '../config/environment.js';
import type { GoogleServiceAccount } from '../google/google-service-account.js';
import { GmailMailer } from './mailer.js';

/** Gmail with a stand-in for Google: what it would send, decoded. */
function mailer(env: Partial<EnvironmentVariables>) {
  const google = {
    accessToken: async () => 'token',
  } as unknown as GoogleServiceAccount;
  const gmail = new GmailMailer(
    google,
    new ConfigService<EnvironmentVariables, true>(env),
  );
  const sent: string[] = [];
  (gmail as unknown as { fetchImpl: typeof fetch }).fetchImpl = async (
    _url,
    init,
  ) => {
    const { raw } = JSON.parse(String(init?.body)) as { raw: string };
    sent.push(Buffer.from(raw, 'base64url').toString('utf8'));
    return new Response('{}', { status: 200 });
  };
  return { gmail, sent };
}

const email = {
  to: 'r@example.com',
  subject: 'Hi',
  text: 'Hello',
  html: '<p>Hello</p>',
};

describe('GmailMailer', () => {
  it('sends from the mailbox it acts as', async () => {
    const { gmail, sent } = mailer({ MAIL_SENDER: 'owner@forgea-lab.com' });
    await gmail.send(email);
    expect(sent[0]).toContain('From: Forgea <owner@forgea-lab.com>');
  });

  it('or shows an alias of it as the sender (MAIL_FROM)', async () => {
    const { gmail, sent } = mailer({
      MAIL_SENDER: 'owner@forgea-lab.com',
      MAIL_FROM: 'hello@forgea-lab.com',
    });
    await gmail.send(email);
    expect(sent[0]).toContain('From: Forgea <hello@forgea-lab.com>');
  });
});
