import type { WhatsApp } from './whatsapp.js';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import { MailTemplates } from './mail-templates.js';
import { type Email, Mailer, toMime, OutboxMailer } from './mailer.js';
import { Notifications } from './notifications.service.js';

/** WhatsApp is tested on its own (whatsapp.spec.ts). */
const noWhatsApp = { send: async () => undefined } as unknown as WhatsApp;
/** Where emails go when they may not be sent (staging's allow-list). */
const kept: Email[] = [];
const outbox = {
  send: async (e: Email) => void kept.push(e),
} as unknown as OutboxMailer;

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

  it('puts the sign-up code in the subject and the text, with no link to follow', () => {
    const email = templates.emailCode({ to: 'r@example.com', code: '042917' });
    expect(email.subject).toBe('042917 is your Forgea code');
    expect(email.text).toContain('Your code is 042917.');
    expect(email.text).not.toContain('http');
  });

  it('lays out a quotation with sizes, in the owner words, and escapes whatever was typed', () => {
    const email = templates.quotationSent({
      to: 'n@example.com',
      name: 'Nour <b>',
      number: 'Q-2026-0001',
      total: '90.00',
      validUntil: new Date('2099-12-31'),
      lines: [
        {
          id: 'l1',
          productId: null,
          description: '<img src=x onerror=alert(1)> stand',
          quantity: 2,
          unitPrice: '25.00',
          discountPercent: '10',
          lineTotal: '45.00',
          isCustom: true,
          size: { x: '30', y: '12.5', z: '18' },
          printFile: null,
          model: null,
        },
      ],
      note: 'Matte "black"',
      delivery: false,
      token: 'a.b-c',
      wording: {
        subject: 'For {name}: {number}',
        intro: null,
        closing: 'Bye {name}',
      },
      whatsappPhone: '+961 70 000 000',
    });
    expect(email.subject).toBe('For Nour <b>: Q-2026-0001');
    expect(email.text).toContain('Dear Nour <b>,');
    expect(email.text).toContain(
      '30 × 12.5 × 18 cm: 2 × $25.00 less 10% = $45.00',
    );
    expect(email.text).toContain('https://forgea-lab.com/q/a.b-c');
    expect(email.text).toContain('Bye Nour <b>');
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt; stand');
    expect(email.html).not.toContain('<img');
    expect(email.html).not.toContain('Nour <b>');
    expect(email.html).toContain('Size 30 × 12.5 × 18 cm');
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
    const notifications = new Notifications(
      mailer,
      templates,
      noWhatsApp,
      outbox,
      config,
    );
    notifications.send('emailCode', { to: 'a@example.com', code: '111111' });
    fail = true;
    expect(() =>
      notifications.send('emailCode', { to: 'b@example.com', code: '111111' }),
    ).not.toThrow();
    await notifications.settled();
    expect(sent.map((e) => e.to)).toEqual(['a@example.com']);
  });

  it('alerts the studio about new work, at its own address, with a dashboard link', async () => {
    const sent: Email[] = [];
    const mailer = { send: async (e: Email) => void sent.push(e) } as Mailer;
    const studio = new ConfigService<EnvironmentVariables, true>({
      PUBLIC_WEB_URL: 'https://forgea-lab.com',
      MAIL_SENDER: 'hello@forgea-lab.com',
    });
    const notifications = new Notifications(
      mailer,
      templates,
      noWhatsApp,
      outbox,
      studio,
    );
    notifications.alertStudio(
      'New order FG-1',
      ['Rana placed it.'],
      '/admin/orders/o-1',
    );
    await notifications.settled();
    expect(sent[0]).toMatchObject({
      to: 'hello@forgea-lab.com',
      subject: 'New order FG-1',
    });
    expect(sent[0]!.text).toContain('https://forgea-lab.com/admin/orders/o-1');

    // No studio address configured: no alert.
    const silent = new Notifications(
      mailer,
      templates,
      noWhatsApp,
      outbox,
      config,
    );
    silent.alertStudio('x', [], '/admin');
    await silent.settled();
    expect(sent).toHaveLength(1);
  });

  it('caps an email per key and hour', async () => {
    const sent: Email[] = [];
    const mailer = { send: async (e: Email) => void sent.push(e) } as Mailer;
    const notifications = new Notifications(
      mailer,
      templates,
      noWhatsApp,
      outbox,
      config,
    );
    const results = [1, 2, 3, 4].map(() =>
      notifications.sendAtMost('password-reset:u1', 3, 'emailCode', {
        to: 'a@example.com',
        code: '111111',
      }),
    );
    await notifications.settled();
    expect(results).toEqual([true, true, true, false]);
    expect(sent).toHaveLength(3);
  });

  it('staging emails only its allow-list; the rest stays in the outbox', async () => {
    const sent: Email[] = [];
    const mailer = { send: async (e: Email) => void sent.push(e) } as Mailer;
    kept.length = 0;
    const staging = new ConfigService<EnvironmentVariables, true>({
      PUBLIC_WEB_URL: 'https://staging.forgea-lab.com',
      MAIL_ALLOWED_RECIPIENTS: 'owner@example.com, @forgea-lab.com',
    });
    const notifications = new Notifications(
      mailer,
      templates,
      noWhatsApp,
      outbox,
      staging,
    );
    for (const to of [
      'Owner@Example.com',
      'team@forgea-lab.com',
      'customer@gmail.com',
    ])
      notifications.send('emailCode', { to, code: '111111' });
    await notifications.settled();
    expect(sent.map((e) => e.to)).toEqual([
      'Owner@Example.com',
      'team@forgea-lab.com',
    ]);
    expect(kept.map((e) => e.to)).toEqual(['customer@gmail.com']);
  });
});
