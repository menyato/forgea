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
