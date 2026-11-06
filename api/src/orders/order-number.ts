import type { Prisma } from '../generated/prisma/client.js';
import { randomBytes } from 'node:crypto';

/** Crockford base32: no I, L, O or U, so numbers read aloud or copied by hand stay unambiguous. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 10;

/**
 * Public custom-request reference, e.g. "CR-7K2M9QX4PB". 10 random characters = 50 bits, so
 * nobody can guess their way to one. 256 is a multiple of 32, so taking each byte modulo 32
 * keeps every character equally likely.
 */
function reference(prefix: 'CR'): string {
  const bytes = randomBytes(LENGTH);
  let suffix = '';
  for (const byte of bytes) suffix += ALPHABET[byte % 32];
  return `${prefix}-${suffix}`;
}

export const generateRequestNumber = () => reference('CR');

/**
 * An order's number: "FG-", the studio's year, and that year's running count ("FG-2026-0001").
 * Readable on the phone; every lookup by number is the signed-in customer's own orders, so
 * a guessable number reveals nothing. The counter row stays locked until the order's
 * transaction ends, so two checkouts never share a number and a failed one leaves no gap.
 */
export async function nextOrderNumber(
  tx: Prisma.TransactionClient,
  now = new Date(),
): Promise<string> {
  const year = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Beirut',
      year: 'numeric',
    }).format(now),
  );
  const [row] = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO "order_sequences" ("year", "last") VALUES (${year}, 1)
    ON CONFLICT ("year") DO UPDATE SET "last" = "order_sequences"."last" + 1
    RETURNING "last"`;
  return orderNumber(year, Number(row!.last));
}

export const orderNumber = (year: number, n: number) =>
  `FG-${year}-${String(n).padStart(4, '0')}`;

// The formats live in @forgea/validation/constants and in database CHECK constraints.
export {
  ORDER_NUMBER_PATTERN,
  REQUEST_NUMBER_PATTERN,
} from '@forgea/validation/constants';
