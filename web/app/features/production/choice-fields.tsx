import { SelectField } from '~/components/ui/field';
import type { Choice } from './choices.server';

/** A printer from the studio's list (Production → Printers). */
export function PrinterField({
  printers,
  value,
  error,
}: {
  printers: readonly Choice[];
  value?: string | null | undefined;
  error?: string | undefined;
}) {
  return (
    <SelectField
      label="Printer"
      name="printerId"
      defaultValue={value ?? ''}
      error={error}
      hint={
        printers.length === 0
          ? 'No printer yet: add one under Production → Printers.'
          : undefined
      }
    >
      <option value="">Choose the printer…</option>
      {printers.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label}
        </option>
      ))}
    </SelectField>
  );
}

/** A reel from stock: its material and colour, with what is on the shelf. */
export function ReelField({
  reels,
  value,
  error,
}: {
  reels: readonly Choice[];
  value?: string | null | undefined;
  error?: string | undefined;
}) {
  return (
    <SelectField
      label="Reel"
      name="stockItemId"
      defaultValue={value ?? ''}
      error={error}
    >
      <option value="">Choose the reel…</option>
      {reels.map((r) => (
        <option key={r.id} value={r.id}>
          {r.label}
        </option>
      ))}
    </SelectField>
  );
}
