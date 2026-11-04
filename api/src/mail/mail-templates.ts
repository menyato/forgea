import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { tokens } from '@forgea/brand';
import {
  CUSTOM_REQUEST_STATUS_LABELS,
  fillQuotationText,
  formatSizeCm,
  QUOTATION_EMAIL_DEFAULTS,
  type QuotationEmailSettings,
  type QuotationLineView,
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

  /** To the studio: something new needs the team (an order, a request, a lead). */
  studioAlert(o: {
    to: string;
    subject: string;
    lines: string[];
    /** Dashboard path, e.g. /admin/orders/…; a button opens it. */
    path: string;
  }): Email {
    return this.email(o.to, o.subject, {
      paragraphs: o.lines,
      action: { label: 'Open in the dashboard', url: `${this.site}${o.path}` },
    });
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

  /**
   * The quotation itself, laid out like a document: the owner's own introduction and closing
   * (Dashboard → Payment & requests, or the standard wording), then every line with its printed
   * size, the total, and a button that opens it online, no account needed.
   */
  quotationSent(q: {
    to: string;
    name: string;
    number: string;
    total: string;
    validUntil: Date;
    lines: QuotationLineView[];
    note: string | null;
    delivery: boolean;
    token: string;
    wording: QuotationEmailSettings;
    whatsappPhone: string;
  }): Email {
    const until = q.validUntil.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    const values = {
      name: q.name,
      number: q.number,
      total: `$${q.total}`,
      validUntil: until,
    };
    const words = (key: keyof QuotationEmailSettings) =>
      fillQuotationText(
        q.wording[key] ?? QUOTATION_EMAIL_DEFAULTS[key],
        values,
      );
    const paragraphs = (text: string) => text.split(/\n{2,}/);
    const url = `${this.site}/q/${encodeURIComponent(q.token)}`;
    const c = tokens.color.light;
    const cell = `padding:10px 8px;border-bottom:1px solid ${c.border};vertical-align:top`;
    const head = `padding:8px;border-bottom:2px solid ${c.text};font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:${c.textMuted};text-align:left`;

    const text = [
      ...paragraphs(words('intro')),
      `Quotation ${q.number}, valid until ${until}`,
      ...q.lines.map(
        (l) =>
          `- ${l.description}${l.size ? `, ${formatSizeCm(l.size)}` : ''}: ${l.quantity} × $${l.unitPrice}${Number(l.discountPercent) > 0 ? ` less ${l.discountPercent}%` : ''} = $${l.lineTotal}`,
      ),
      `Total: $${q.total}${q.delivery ? ' (delivery included)' : ''}`,
      ...(q.note ? [q.note] : []),
      `See and accept it online: ${url}`,
      ...paragraphs(words('closing')),
      `WhatsApp: ${q.whatsappPhone}`,
      'Forgea — design and 3D printing, made in Lebanon',
    ].join('\n\n');

    const rows = q.lines
      .map(
        (l) => `<tr>
<td style="${cell}"><strong>${escape(l.description)}</strong>${
          l.size
            ? `<br><span style="font-size:13px;color:${c.textMuted}">Size ${escape(formatSizeCm(l.size))} <span style="font-size:11px">(width × depth × height)</span></span>`
            : ''
        }</td>
<td style="${cell};text-align:center">${l.quantity}</td>
<td style="${cell};text-align:right;white-space:nowrap">$${escape(l.unitPrice)}${
          Number(l.discountPercent) > 0
            ? `<br><span style="font-size:12px;color:${c.textMuted}">less ${escape(l.discountPercent)}%</span>`
            : ''
        }</td>
<td style="${cell};text-align:right;white-space:nowrap;font-weight:600">$${escape(l.lineTotal)}</td>
</tr>`,
      )
      .join('\n');
    const para = (p: string) =>
      `<p style="margin:0 0 14px;line-height:1.6">${escape(p).replace(/\n/g, '<br>')}</p>`;

    const html = `<!doctype html><html><body style="margin:0;background:${c.background};font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:${c.text}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:${c.surface};border:1px solid ${c.border};border-radius:10px;overflow:hidden">
<tr><td style="background:${c.text};padding:22px 28px">
<table role="presentation" width="100%"><tr>
<td style="font-size:24px;font-weight:800;letter-spacing:-0.02em;color:${c.background}">Forgea</td>
<td align="right" style="font-size:13px;color:${c.background}">Quotation<br><strong style="font-size:16px">${escape(q.number)}</strong></td>
</tr></table></td></tr>
<tr><td style="padding:28px">
${paragraphs(words('intro')).map(para).join('\n')}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 8px;border-collapse:collapse;font-size:14px">
<tr><th style="${head}">Item</th><th style="${head};text-align:center">Qty</th><th style="${head};text-align:right">Unit</th><th style="${head};text-align:right">Amount</th></tr>
${rows}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">
<tr><td></td><td align="right" style="padding:14px 8px 0">
<table role="presentation" cellpadding="0" cellspacing="0" style="background:${c.background};border-radius:8px">
<tr><td style="padding:12px 18px;font-size:13px;color:${c.textMuted}">Total (USD, taxes included)${q.delivery ? '<br>delivery included' : ''}</td>
<td style="padding:12px 18px;font-size:22px;font-weight:800;white-space:nowrap">$${escape(q.total)}</td></tr>
</table></td></tr></table>
<p style="margin:0 0 18px;font-size:13px;color:${c.textMuted}">Valid until <strong style="color:${c.text}">${escape(until)}</strong>.</p>
${q.note ? `<div style="margin:0 0 20px;padding:14px 16px;border-left:3px solid ${c.accent};background:${c.background};line-height:1.55">${escape(q.note).replace(/\n/g, '<br>')}</div>` : ''}
<p style="margin:8px 0 26px"><a href="${escape(url)}" style="display:inline-block;background:${c.accent};color:${c.onAccent};padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:700">See and accept the quotation</a></p>
${paragraphs(words('closing')).map(para).join('\n')}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid ${c.border};font-size:12px;color:${c.textMuted}">
Forgea — design and 3D printing, made in Lebanon · WhatsApp ${escape(q.whatsappPhone)}
</td></tr>
</table></td></tr></table></body></html>`;
    return {
      to: q.to,
      subject: words('subject'),
      text,
      html,
    };
  }

  /** The 6-digit code that finishes a new account (no link: it is typed into the open page). */
  emailCode(v: { to: string; code: string }): Email {
    return this.email(v.to, `${v.code} is your Forgea code`, {
      paragraphs: [
        `Your code is ${v.code}. Enter it on the page where you created your account.`,
        'It works for 10 minutes. If you did not create a Forgea account, ignore this email.',
      ],
    });
  }

  /** A quotation the customer declined (their receipt) or the studio withdrew. */
  quotationStatus(q: {
    to: string;
    name: string;
    number: string;
    status: 'DECLINED' | 'CANCELLED';
  }): Email {
    const declined = q.status === 'DECLINED';
    return this.email(
      q.to,
      declined
        ? `You declined quotation ${q.number}`
        : `Quotation ${q.number} was withdrawn`,
      {
        paragraphs: [
          `Dear ${q.name},`,
          declined
            ? `Thank you for letting us know: quotation ${q.number} is declined. If something could change your mind (the price, a size, a material), reply or message us and we will send a new one.`
            : `We have withdrawn quotation ${q.number}; it can no longer be accepted. If you still want it, ask us for a new one.`,
        ],
      },
    );
  }

  passwordReset(v: { to: string; token: string }): Email {
    return this.email(v.to, 'Choose a new password', {
      paragraphs: [
        'Someone (we hope you) asked to choose a new password for your Forgea account.',
        'The link works once, for 30 minutes. If it was not you, ignore this email: your password stays as it is.',
      ],
      action: {
        label: 'Choose a new password',
        url: `${this.site}/reset-password?token=${encodeURIComponent(v.token)}`,
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
