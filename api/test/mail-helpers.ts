import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
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
