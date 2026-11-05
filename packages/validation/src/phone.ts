import { isValidPhoneNumber } from 'libphonenumber-js/max';
import { registerDecorator, type ValidationOptions } from 'class-validator';

/**
 * A real phone number: checked against its country's numbering ranges (Google's libphonenumber
 * data, the full set: not only the length), Lebanese when it has no country code, so
 * "70 123 456", "03 456 789" and "+33 6 12 34 56 78" pass, and "1111111", "70 12" or
 * "+961 99 999 999" don't. The number is kept as typed.
 */
export function isPhone(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  // Only what people type in a phone number; libphonenumber alone would also read "tel:" etc.
  if (!/^\+?[0-9 ().-]{6,24}$/.test(v)) return false;
  // "1111111" fits a Beirut landline's shape, but nobody's number is one digit over and over.
  const national = v
    .replace(/\D/g, '')
    .replace(/^(00)?961/, '')
    .replace(/^0/, '');
  if (/^(\d)\1+$/.test(national)) return false;
  return isValidPhoneNumber(v, 'LB');
}

export function IsPhone(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'isPhone',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: 'Enter a valid phone number', ...options },
      validator: { validate: isPhone },
    });
}
