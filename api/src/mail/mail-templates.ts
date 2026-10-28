import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { tokens } from '@forgea/brand';
import {
  CUSTOM_REQUEST_STATUS_LABELS,
  type CustomRequestStatus,
  ORDER_STATUS_LABELS,
  type OrderStatus,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from '@forgea/types';
import type { EnvironmentVariables } from '../config/environment.js';
import type { Email } from './mailer.js';

/** Everything an email shows comes from customers or staff, so it is always escaped. */
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

interface Body {
  /** Plain paragraphs; the same text makes the plain-text and the HTML part. */
  paragraphs: string[];
  action?: { label: string; url: string };
}

/**
 * The emails the site sends, in the brand's colours and wording (ORDER_STATUS_LABELS, the
 * same words the site shows). Each has a plain-text part for mail apps that prefer it.
 */
@Injectable()
export class MailTemplates {
  private readonly site: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.site = config.get('PUBLIC_WEB_URL', { infer: true });
  }

  orderPlaced(o: {
    to: string;
    name: string;
    orderNumber: string;
    total: string;
    paymentMethod: PaymentMethod;
    depositRequired: string;
    transferPhone: string | null;
  }): Email {
    const deposit = Number(o.depositRequired) > 0;
    return this.email(o.to, `Order ${o.orderNumber} received`, {
      paragraphs: [
        `Hello ${o.name}, thank you for your order ${o.orderNumber} ($${o.total}).`,
        `Payment: ${PAYMENT_METHOD_LABELS[o.paymentMethod].toLowerCase()}.`,
        ...(deposit
          ? [
              `Made-to-order items start once the deposit of $${o.depositRequired} arrives${
                o.transferPhone
                  ? `: send it to ${o.transferPhone} with ${o.orderNumber} in the note`
                  : ''
              }.`,
            ]
          : []),
        'We will write again at every step.',
      ],
      action: { label: 'Follow your order', url: `${this.site}/orders` },
    });
  }

  orderStatus(o: {
    to: string;
    orderNumber: string;
    status: OrderStatus;
    note: string | null;
  }): Email {
    const label = ORDER_STATUS_LABELS[o.status];
    return this.email(o.to, `Order ${o.orderNumber}: ${label.title}`, {
      paragraphs: [
        `${label.title}. ${label.detail}`,
        ...(o.note ? [`A note from the studio: ${o.note}`] : []),
      ],
      action: { label: 'Follow your order', url: `${this.site}/orders` },
    });
  }

  quoteReady(r: {
    to: string;
    requestNumber: string;
    title: string;
    price: string;
    note: string | null;
    expiresAt: Date;
  }): Email {
    return this.email(r.to, `Your quote for "${r.title}"`, {
      paragraphs: [
        `Our price for "${r.title}" (${r.requestNumber}) is $${r.price}.`,
        ...(r.note ? [r.note] : []),
        `Accept it before ${r.expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} to place the order.`,
      ],
      action: {
        label: 'See the quote',
        url: `${this.site}/requests/${r.requestNumber}`,
      },
    });
  }

  requestStatus(r: {
    to: string;
    requestNumber: string;
    title: string;
    status: CustomRequestStatus;
    note: string | null;
  }): Email {
    const label = CUSTOM_REQUEST_STATUS_LABELS[r.status];
    return this.email(r.to, `"${r.title}": ${label.title}`, {
      paragraphs: [
        `${label.title}. ${label.detail}`,
        ...(r.note ? [`A note from the studio: ${r.note}`] : []),
      ],
      action: {
        label: 'See the request',
        url: `${this.site}/requests/${r.requestNumber}`,
      },
    });
  }

  quotationSent(q: {
    to: string;
    number: string;
    total: string;
    validUntil: Date;
  }): Email {
    const until = q.validUntil.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    });
    return this.email(q.to, `Quotation ${q.number} from Forgea`, {
      paragraphs: [
        `Here is our quotation ${q.number}: $${q.total}.`,
        `It is valid until ${until}. Accept it online to place the order.`,
      ],
      action: {
        label: 'See the quotation',
        url: `${this.site}/quotations/${q.number}`,
      },
    });
  }

  verifyEmail(v: { to: string; token: string }): Email {
    return this.email(v.to, 'Confirm your email address', {
      paragraphs: [
        'Confirm this address so we can send you order updates and quotes.',
        'The link works for two days. If you did not create a Forgea account, ignore this email.',
      ],
      action: {
        label: 'Confirm my address',
        url: `${this.site}/verify-email?token=${encodeURIComponent(v.token)}`,
      },
    });
  }

  private email(to: string, subject: string, body: Body): Email {
    const c = tokens.color.light;
    const text = [
      ...body.paragraphs,
      ...(body.action ? [`${body.action.label}: ${body.action.url}`] : []),
      '',
      'Forgea — design and 3D printing, made in Lebanon',
    ].join('\n\n');
    const html = `<!doctype html><html><body style="margin:0;background:${c.background};font-family:system-ui,sans-serif;color:${c.text}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:560px;background:${c.surface};border:1px solid ${c.border};border-radius:8px">
<tr><td style="padding:28px">
<p style="margin:0 0 20px;font-size:22px;font-weight:800;letter-spacing:-0.02em">Forgea</p>
${body.paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.55">${escape(p)}</p>`).join('\n')}
${
  body.action
    ? `<p style="margin:24px 0 0"><a href="${escape(body.action.url)}" style="display:inline-block;background:${c.accent};color:${c.onAccent};padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">${escape(body.action.label)}</a></p>`
    : ''
}
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:${c.textMuted}">Forgea — design and 3D printing, made in Lebanon</p>
</td></tr></table></body></html>`;
    return { to, subject, text, html };
  }
}
