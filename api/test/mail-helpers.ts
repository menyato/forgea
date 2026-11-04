import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { Notifications } from '../src/mail/notifications.service.js';

const OUTBOX = resolve('.outbox-test');

/** Emails written to the test outbox for one address: subject and decoded plain text. */
export async function inbox(app: NestExpressApplication, to: string) {
  await app.get(Notifications).settled();
  const files = await readdir(OUTBOX).catch(() => [] as string[]);
  const mails = await Promise.all(
    files.map((f) => readFile(join(OUTBOX, f), 'utf8')),
  );
  return mails
    .filter((m) => m.includes(`\r\nTo: ${to}\r\n`))
    .map((m) => ({
      subject: decodeHeader(/\r\nSubject: (.*)\r\n/.exec(m)?.[1] ?? ''),
      text: Buffer.from(
        (
          /text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/.exec(
            m,
          )?.[1] ?? ''
        ).replace(/\r\n/g, ''),
        'base64',
      ).toString('utf8'),
    }));
}

/** A header as written by the mailer: plain ASCII, or =?UTF-8?B?…?= for anything else. */
const decodeHeader = (value: string) =>
  value.replace(/=\?UTF-8\?B\?([^?]*)\?=\s?/gi, (_, b64: string) =>
    Buffer.from(b64, 'base64').toString('utf8'),
  );

/** The latest sign-up code emailed to an address (its subject starts with the code). */
export async function latestCode(
  app: NestExpressApplication,
  to: string,
): Promise<string> {
  const codes = (await inbox(app, to))
    .map((m) => /^(\d{6}) is your Forgea code$/.exec(m.subject)?.[1])
    .filter((c): c is string => c !== undefined);
  const code = codes.at(-1);
  if (!code) throw new Error(`no sign-up code was emailed to ${to}`);
  return code;
}

/**
 * Signs up through the real flow (register, then the emailed code): the new customer's
 * session cookie header.
 */
export async function registerCustomer(
  app: NestExpressApplication,
  body: { email: string; password: string; name?: string },
): Promise<string> {
  const http = () => request(app.getHttpServer());
  const pending = await http()
    .post('/auth/register')
    .set('x-forgea-csrf', '1')
    .send(body)
    .expect(202);
  const res = await http()
    .post('/auth/email-code')
    .set('x-forgea-csrf', '1')
    .send({
      ticket: pending.body.ticket,
      code: await latestCode(app, body.email),
    })
    .expect(200);
  return (res.headers['set-cookie'] as unknown as string[])
    .map((c) => c.split(';')[0])
    .join('; ');
}

/** WhatsApp updates written for this number (international digits), oldest first. */
export async function whatsappTo(
  app: NestExpressApplication,
  number: string,
): Promise<{ about: string; update: string; link: string }[]> {
  await app.get(Notifications).settled();
  const dir = `${OUTBOX}-whatsapp`;
  const files = (await readdir(dir).catch(() => [] as string[])).sort();
  const bodies = await Promise.all(
    files.map(async (f) => JSON.parse(await readFile(join(dir, f), 'utf8'))),
  );
  return bodies
    .filter((b: { to: string }) => b.to === number)
    .map(
      (b: {
        template: { components: { parameters: { text: string }[] }[] };
      }) => {
        const [about, update, link] = b.template.components[0]!.parameters.map(
          (p) => p.text,
        );
        return { about: about!, update: update!, link: link! };
      },
    );
}
