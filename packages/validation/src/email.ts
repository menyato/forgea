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
