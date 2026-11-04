import { PaymentMethod } from './generated/prisma/enums.js';

/** The owner's rules for custom requests (docs/CUSTOM_REQUESTS.md), edited in the dashboard. */
export interface RequestSettings {
  /** A quote nobody answers within this many days expires. */
  quoteValidityDays: number;
  /** Refunded when the customer cancels before printing starts. */
  depositRefundable: boolean;
  customUploadMaxMb: number;
  /** For the instant estimate: how solid the print is assumed to be, and the range's width. */
  estimateSolidityPercent: number;
  estimateSpreadPercent: number;
}

/** Shop-wide settings (GET /store-settings), editable by the admin. */
export interface StoreSettings {
  transferPhone: string;
  transferInstructions: string | null;
  whatsappPhone: string;
  requests: RequestSettings;
}

/** How each payment method is described to customers, on the site and in emails. */
export const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  [PaymentMethod.COD]: 'Cash on delivery',
  [PaymentMethod.TRANSFER]: 'Money transfer to our number',
};

/**
 * A WhatsApp click-to-chat link (wa.me) with a message ready to send. wa.me needs the
 * international number: "+…" or "00…" is kept as is; a local Lebanese number drops its
 * leading 0 and gets +961 (70 904 044 → 96170904044, 01 234 567 → 9611234567).
 */
export function whatsappUrl(phone: string, message: string): string {
  return `https://wa.me/${whatsappNumber(phone)}?text=${encodeURIComponent(message)}`;
}

/** The number in international form, digits only (a local one is Lebanese: 70 123 456 → 96170123456). */
export function whatsappNumber(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  const international = phone.trim().startsWith('+') || digits.startsWith('00');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (
    !international &&
    !(digits.startsWith('961') && digits.length >= 10)
  ) {
    digits = `961${digits.replace(/^0/, '')}`;
  }
  return digits;
}

/** The quotation email as the owner wrote it (empty: the standard wording below). */
export interface QuotationEmailSettings {
  subject: string | null;
  intro: string | null;
  closing: string | null;
}

/** Forgea's standard quotation email; the owner can change each part in the dashboard. */
export const QUOTATION_EMAIL_DEFAULTS = {
  subject: 'Your quotation {number} from Forgea',
  intro:
    'Dear {name},\n\nThank you for thinking of Forgea. As promised, here is our quotation for your project. Every piece is printed to order in our studio, to the sizes listed below.',
  closing:
    'You can accept it online in one click, and we start as soon as you confirm. To change a size, a colour or a quantity, simply reply to this email or message us on WhatsApp.\n\nKind regards,\nThe Forgea team',
} as const;

/** Fills {name}, {number}, {total} and {validUntil}; anything else in braces stays as typed. */
export function fillQuotationText(
  text: string,
  values: Record<'name' | 'number' | 'total' | 'validUntil', string>,
): string {
  return text.replace(
    /\{(name|number|total|validUntil)\}/g,
    (_, key: keyof typeof values) => values[key],
  );
}

/** "12.5 × 8 × 4.2 cm": a printed size, width × depth × height. */
export const formatSizeCm = (size: { x: string; y: string; z: string }) =>
  `${size.x} × ${size.y} × ${size.z} cm`;
