import { CustomRequestStatus } from './generated/prisma/enums.js';

/** How each request status is described, to the customer and in the dashboard. */
export const CUSTOM_REQUEST_STATUS_LABELS: Readonly<
  Record<CustomRequestStatus, { title: string; detail: string }>
> = {
  [CustomRequestStatus.SUBMITTED]: {
    title: 'Waiting for a quote',
    detail: 'We are looking at your request and will send you a price.',
  },
  [CustomRequestStatus.QUOTED]: {
    title: 'Quote ready',
    detail: 'Accept the price to place the order, or decline it.',
  },
  [CustomRequestStatus.ACCEPTED]: {
    title: 'Accepted',
    detail: 'Your order was created; it starts once the deposit arrives.',
  },
  [CustomRequestStatus.DECLINED]: {
    title: 'Declined',
    detail: 'You turned this quote down.',
  },
  [CustomRequestStatus.CANCELLED]: {
    title: 'Cancelled',
    detail: 'This request was closed.',
  },
};

/** A quote is answerable until it expires; afterwards only a new quote reopens it. */
export function isRequestExpired(
  status: CustomRequestStatus,
  quoteExpiresAt: Date | string | null,
  now = new Date(),
): boolean {
  return (
    status === CustomRequestStatus.QUOTED &&
    quoteExpiresAt !== null &&
    new Date(quoteExpiresAt).getTime() <= now.getTime()
  );
}

/**
 * The lines of a price by the shop's rules, in order, as the dashboard names them. A product may
 * leave some out for good (`Product.priceLinesOff`), and the owner may switch any off before
 * quoting a custom request (`POST /custom-requests/:id/price`).
 */
export const PRICE_LINES = [
  { key: 'material', label: 'Filament' },
  { key: 'machine', label: 'Printer time' },
  { key: 'waste', label: 'Purge waste' },
  { key: 'failure', label: 'Failed prints allowance' },
  { key: 'labor', label: 'Labour' },
  { key: 'packaging', label: 'Packaging' },
  { key: 'profit', label: 'Profit' },
] as const;

export type PriceLine = (typeof PRICE_LINES)[number]['key'];
