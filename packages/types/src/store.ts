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
  let digits = phone.replace(/\D/g, '');
  const international = phone.trim().startsWith('+') || digits.startsWith('00');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (
    !international &&
    !(digits.startsWith('961') && digits.length >= 10)
  ) {
    digits = `961${digits.replace(/^0/, '')}`;
  }
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
