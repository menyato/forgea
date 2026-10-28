import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import { MailTemplates } from './mail-templates.js';
import { type Email, Mailer, toMime } from './mailer.js';
import { Notifications } from './notifications.service.js';

const config = new ConfigService<EnvironmentVariables, true>({
  PUBLIC_WEB_URL: 'https://forgea-lab.com',
});
const templates = new MailTemplates(config);

/** The decoded parts of a MIME message, for checking what the reader sees. */
function parts(mime: string): string[] {
  return [...mime.matchAll(/base64\r\n\r\n([\s\S]*?)\r\n--/g)].map((m) =>
    Buffer.from(m[1]!.replace(/\r\n/g, ''), 'base64').toString('utf8'),
  );
}

describe('toMime', () => {
  const email: Email = {
    to: 'rana@example.com',
    subject: 'Order FG-1 received',
    text: 'Hello',
    html: '<p>Hello</p>',
  };

  it('carries a plain-text and an HTML part', () => {
    const mime = toMime(email, 'hello@forgea-lab.com');
    expect(mime).toMatch(
      /^From: Forgea <hello@forgea-lab\.com>\r\nTo: rana@example\.com\r\n/,
    );
    expect(mime).toContain('Content-Type: multipart/alternative');
    expect(parts(mime)).toEqual(['Hello', '<p>Hello</p>']);
  });

  it('cannot be given extra headers through a subject or an address', () => {
    const mime = toMime(
      {
        ...email,
        subject: 'Hi\r\nBcc: victim@example.com',
        to: 'a@b.c\nBcc: x@y.z',
      },
      'hello@forgea-lab.com',
    );
    expect(mime).not.toMatch(/^Bcc:/m);
  });

  it('encodes non-ASCII subjects (Arabic names, emoji)', () => {
    const mime = toMime(
      { ...email, subject: 'طلبك جاهز' },
      'hello@forgea-lab.com',
    );
    expect(mime).toContain(
      `Subject: =?UTF-8?B?${Buffer.from('طلبك جاهز').toString('base64')}?=`,
    );
  });
});

describe('MailTemplates', () => {
  it('escapes everything customers or staff wrote', () => {
    const email = templates.orderStatus({
      to: 'rana@example.com',
      orderNumber: 'FG-1',
      status: 'READY',
      note: '<script>alert(1)</script>',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.text).toContain('<script>alert(1)</script>');
  });

  it('uses the same status words as the site, and links back to it', () => {
    const email = templates.orderStatus({
      to: 'r@example.com',
      orderNumber: 'FG-1',
      status: 'OUT_FOR_DELIVERY',
      note: null,
    });
    expect(email.subject).toBe('Order FG-1: Out for delivery');
    expect(email.text).toContain('https://forgea-lab.com/orders');
  });

  it('tells a made-to-order customer where to send the deposit', () => {
    const email = templates.orderPlaced({
      to: 'r@example.com',
      name: 'Rana',
      orderNumber: 'FG-2',
      total: '30.00',
      paymentMethod: 'TRANSFER',
      depositRequired: '15.00',
      transferPhone: '+961 70 904 044',
    });
    expect(email.text).toContain('deposit of $15.00');
    expect(email.text).toContain('+961 70 904 044 with FG-2 in the note');
  });

  it('puts the verification token in a link to the site', () => {
    const email = templates.verifyEmail({
      to: 'r@example.com',
      token: 'a.b+c',
    });
    expect(email.text).toContain(
      'https://forgea-lab.com/verify-email?token=a.b%2Bc',
    );
  });
});

describe('Notifications', () => {
  it('sends in the background, and a failed send never throws to the caller', async () => {
    const sent: Email[] = [];
    let fail = false;
    const mailer = {
      send: async (e: Email) => {
        if (fail) throw new Error('Gmail is down');
        sent.push(e);
      },
    } as Mailer;
    const notifications = new Notifications(mailer, templates);
    notifications.send('verifyEmail', { to: 'a@example.com', token: 't' });
    fail = true;
    expect(() =>
      notifications.send('verifyEmail', { to: 'b@example.com', token: 't' }),
    ).not.toThrow();
    await notifications.settled();
    expect(sent.map((e) => e.to)).toEqual(['a@example.com']);
  });
});
