import type { OptionGroupView, ProductColourView } from '@forgea/types';
import { Button } from '~/components/ui/button';
import { Swatch } from '~/features/stock/stock-ui';

/**
 * A multi-colour product (from its 3MF): the grams each filament colour takes for one piece.
 * Each colour is one the shop names (an option value with a swatch), so orders take its grams
 * from that colour's stock. They add up to the product's grams.
 */
export function ColoursEditor({
  value,
  onChange,
  groups,
  errors,
}: {
  value: ProductColourView[];
  onChange: (next: ProductColourView[]) => void;
  groups: readonly OptionGroupView[];
  errors: Partial<Record<string, string>>;
}) {
  if (value.length === 0) return null;
  const named = [
    ...new Map(
      groups
        .flatMap((g) => g.values)
        .filter((v) => v.active && v.swatchHex)
        .map((v) => [v.label, v.swatchHex!]),
    ),
  ];
  const total = value.reduce((n, c) => n + (Number(c.grams) || 0), 0);
  const set = (i: number, patch: Partial<ProductColourView>) =>
    onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const listError = Object.entries(errors).find(([k]) =>
    k.startsWith('colours'),
  )?.[1];

  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">
        Colours ({total.toFixed(1)} g in all)
      </legend>
      <p className="text-sm text-text-muted">
        Orders take each colour&apos;s grams from its stock. Name each colour as
        the shop does.
      </p>
      <datalist id="product-colour-names">
        {named.map(([label]) => (
          <option key={label} value={label} />
        ))}
      </datalist>
      {value.map((c, i) => (
        <div
          key={`${c.hex}-${i}`}
          className="grid grid-cols-[auto_minmax(0,1fr)_6rem_auto] items-center gap-2"
        >
          <Swatch hex={named.find(([l]) => l === c.colour)?.[1] ?? c.hex} />
          <input
            id={`product-colour-${i}`}
            name={`product-colour-${i}`}
            aria-label={`Colour ${i + 1} (file colour ${c.hex})`}
            list="product-colour-names"
            autoComplete="off"
            required
            placeholder={`Colour for ${c.hex}`}
            value={c.colour}
            onChange={(e) => set(i, { colour: e.currentTarget.value })}
            className="min-w-0 rounded-md border border-border bg-surface px-2 py-1 text-sm"
          />
          <input
            id={`product-colour-grams-${i}`}
            name={`product-colour-grams-${i}`}
            aria-label={`Grams of colour ${i + 1}`}
            inputMode="decimal"
            autoComplete="off"
            value={c.grams}
            onChange={(e) => set(i, { grams: e.currentTarget.value })}
            className="rounded-md border border-border bg-surface px-2 py-1 text-right text-sm tabular-nums"
          />
          <Button
            variant="quiet"
            aria-label={`Remove colour ${i + 1}`}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            ×
          </Button>
        </div>
      ))}
      {listError && <p className="text-sm text-danger">{listError}</p>}
    </fieldset>
  );
}
