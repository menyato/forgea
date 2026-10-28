import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { type ValidationError, validateSync } from 'class-validator';

export type FieldErrors = Partial<Record<string, string>>;

/**
 * An empty field fails several rules at once (too short, not a string, …). Show the most
 * useful one: "missing" first, then format, then length limits.
 */
const MESSAGE_PRIORITY = [
  'isDefined',
  'isNotEmpty',
  'minLength',
  'isEmail',
  'matches',
  'isIn',
  'isBoolean',
  'isUuid',
  'isInt',
  'min',
  'max',
  'maxLength',
  'isString',
];

function bestMessage(constraints: Record<string, string> | undefined): string {
  if (!constraints) return 'Check this field';
  const key =
    MESSAGE_PRIORITY.find((k) => k in constraints) ??
    Object.keys(constraints)[0];
  return (key && constraints[key]) || 'Check this field';
}
export type FormResult<T> =
  { ok: true; value: T } | { ok: false; errors: FieldErrors };

/**
 * Validates form input with the same DTO class the API uses (@forgea/validation), so the
 * page can show field errors immediately — the API still validates again on its side.
 */
export function validateForm<T extends object>(
  cls: new () => T,
  values: Record<string, unknown>,
): FormResult<T> {
  const instance = plainToInstance(cls, values);
  const errors = validateSync(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length === 0) return { ok: true, value: instance };
  return { ok: false, errors: Object.fromEntries(flatten(errors, '')) };
}

/** Nested rows (a product's options) are reported by path: "options.0.valueIds". */
function flatten(
  errors: readonly ValidationError[],
  prefix: string,
): [string, string][] {
  return errors.flatMap((e) => {
    const path = prefix + e.property;
    return e.children?.length
      ? flatten(e.children, `${path}.`)
      : [[path, bestMessage(e.constraints)]];
  });
}

/** Reads only the listed text fields; empty strings become undefined (= not provided). */
export function textFields<const K extends string>(
  form: FormData,
  names: readonly K[],
): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const name of names) {
    const value = form.get(name);
    if (typeof value === 'string' && value.trim() !== '') out[name] = value;
  }
  return out;
}

/** A JSON field (e.g. the options a product page or the product form builds). */
export function jsonField(form: FormData, name: string): unknown {
  const value = form.get(name);
  if (typeof value !== 'string' || !value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
