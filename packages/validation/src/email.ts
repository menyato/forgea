import { registerDecorator, type ValidationOptions } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Emails are stored lowercased (a CHECK constraint enforces it), so every comparison is
 * case-insensitive without a special column type.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Applies normalizeEmail during plainToInstance. Non-strings pass through to fail validation. */
export const NormalizeEmail = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  );

/** Trims surrounding whitespace from string fields. */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

/** "A,B,C" in a query string → ["A", "B", "C"] (a dashboard tab that groups statuses). */
export const CommaList = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.split(',').filter((v) => v !== '')
      : value,
  );

/** "true" in a query string → true; anything else stays as it is and fails validation. */
export const QueryBoolean = () =>
  Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  );

/** The addresses most people have: a near-miss of one of these is almost always a typo. */
const POPULAR = [
  'gmail.com',
  'hotmail.com',
  'outlook.com',
  'yahoo.com',
  'icloud.com',
  'live.com',
  'hotmail.fr',
  'yahoo.fr',
  'protonmail.com',
];
/** Real domains a typo check must never refuse, though they look like popular ones. */
const REAL = new Set([
  ...POPULAR,
  'mail.com',
  'ymail.com',
  'gmx.com',
  'me.com',
  'mac.com',
  'msn.com',
  'aol.com',
  'live.fr',
  'outlook.fr',
  'proton.me',
]);
/** Endings typed for ".com" that are no real domain. */
const BAD_ENDINGS: Record<string, string> = {
  '.con': '.com',
  '.cmo': '.com',
  '.ocm': '.com',
  '.comm': '.com',
  '.coom': '.com',
  '.vom': '.com',
  '.xom': '.com',
};

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array<number>(b.length).fill(0),
  ]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
        // Two letters swapped ("gmial") is one slip, not two.
        i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]
          ? d[i - 2]![j - 2]! + 1
          : Infinity,
      );
  return d[a.length]![b.length]!;
}

/** The address it was probably meant to be ("sara@gmial.com" → "sara@gmail.com"), or null. */
export function emailTypo(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (REAL.has(domain)) return null;
  for (const [bad, good] of Object.entries(BAD_ENDINGS))
    if (domain.endsWith(bad))
      return `${local}@${domain.slice(0, -bad.length)}${good}`;
  // Only the name, with the same ending: "outlook.de" is Outlook in Germany, not a typo.
  const [name, ...rest] = domain.split('.');
  const near = POPULAR.find((p) => {
    const [popular, ...ending] = p.split('.');
    return (
      ending.join('.') === rest.join('.') &&
      name !== popular &&
      distance(name!, popular!) <= (popular!.length <= 5 ? 1 : 2)
    );
  });
  return near ? `${local}@${near}` : null;
}

/** Refuses an address that is a near-miss of a popular one, saying which was meant. */
export function NoEmailTypo(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'noEmailTypo',
      target: target.constructor,
      propertyName: propertyName as string,
      options: {
        message: (args) =>
          `Check the address: did you mean ${emailTypo(String(args.value))}?`,
        ...options,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value !== 'string' || emailTypo(value) === null,
      },
    });
}
