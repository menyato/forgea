import { randomBytes } from 'node:crypto';

/** Crockford base32: no I, L, O or U, so numbers read aloud or copied by hand stay unambiguous. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 10;

/**
 * Public order reference, e.g. "FG-7K2M9QX4PB". 10 random characters = 50 bits, about a
 * quadrillion possibilities, so a number quoted on WhatsApp or the phone reveals nothing about
 * other orders, and nobody can guess their way to one.
 * 256 is a multiple of 32, so taking each byte modulo 32 keeps every character equally likely.
 */
function reference(prefix: 'FG' | 'CR'): string {
  const bytes = randomBytes(LENGTH);
  let suffix = '';
  for (const byte of bytes) suffix += ALPHABET[byte % 32];
  return `${prefix}-${suffix}`;
}

export const generateOrderNumber = () => reference('FG');
/** Custom requests ("CR-…") follow the same rules. */
export const generateRequestNumber = () => reference('CR');

// The formats live in @forgea/validation/constants and in database CHECK constraints.
export {
  ORDER_NUMBER_PATTERN,
  REQUEST_NUMBER_PATTERN,
} from '@forgea/validation/constants';
