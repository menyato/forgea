import { describe, expect, it } from 'vitest';
import { PaymentMethod } from './generated/prisma/enums.js';
import {
  PAYMENT_METHOD_LABELS,
  whatsappUrl,
  fillQuotationText,
  formatSizeCm,
  QUOTATION_EMAIL_DEFAULTS,
} from './store.js';

describe('whatsappUrl', () => {
  it.each([
    ['+961 70 904 044', '96170904044'],
    ['70904044', '96170904044'],
    ['070 904 044', '96170904044'],
    ['00961 70 904044', '96170904044'],
    ['+33 6 12 34 56 78', '33612345678'],
    ['01 234 567', '9611234567'],
    ['96170904044', '96170904044'],
  ])('%s → wa.me/%s', (phone, digits) => {
    expect(whatsappUrl(phone, 'x')).toBe(`https://wa.me/${digits}?text=x`);
  });

  it('encodes the message', () => {
    expect(whatsappUrl('70904044', 'Order FG-7K2M9QX4PB — hi & thanks')).toBe(
      'https://wa.me/96170904044?text=Order%20FG-7K2M9QX4PB%20%E2%80%94%20hi%20%26%20thanks',
    );
  });
});

describe('PAYMENT_METHOD_LABELS', () => {
  it('describes every payment method', () => {
    for (const m of Object.values(PaymentMethod))
      expect(PAYMENT_METHOD_LABELS[m]).toBeTruthy();
  });
});

describe('the quotation email wording', () => {
  const values = {
    name: 'Nour',
    number: 'Q-2026-0001',
    total: '$90.00',
    validUntil: '31 December 2099',
  };

  it('fills the four placeholders, every time they appear', () => {
    expect(
      fillQuotationText(
        '{name}: {number} for {total} until {validUntil}. {name}!',
        values,
      ),
    ).toBe('Nour: Q-2026-0001 for $90.00 until 31 December 2099. Nour!');
  });

  it('leaves anything else in braces as the owner typed it', () => {
    expect(fillQuotationText('{nam} {constructor} {{name}}', values)).toBe(
      '{nam} {constructor} {Nour}',
    );
  });

  it('has standard words for each part', () => {
    expect(QUOTATION_EMAIL_DEFAULTS.subject).toContain('{number}');
    expect(QUOTATION_EMAIL_DEFAULTS.intro).toContain('{name}');
    expect(QUOTATION_EMAIL_DEFAULTS.closing.length).toBeGreaterThan(20);
  });

  it('writes a size as width × depth × height in cm', () => {
    expect(formatSizeCm({ x: '30', y: '12.5', z: '18' })).toBe(
      '30 × 12.5 × 18 cm',
    );
  });
});
