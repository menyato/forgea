import {
  type OptionGroupView,
  type ProductColourView,
  startingChoice,
} from '@forgea/types';
import { PRODUCT_PART_NAME_MAX_LENGTH } from '@forgea/validation/constants';
import { Button } from '~/components/ui/button';
import { SelectField } from '~/components/ui/field';
import { Swatch } from '~/features/stock/stock-ui';

/** A filament on the shelf, as bought: its material, name, look and cost per gram. */
export interface Filament {
  id: string;
  material: string;
  colour: string;
  swatchHex: string | null;
  costPerGram: string;
}

/**
 * A multi-colour product (from its 3MF): the grams each filament colour takes for one piece.
 * Each colour is one the shop names (an option value with a swatch), so orders take its grams
 * from that colour's stock. They add up to the product's grams.
 *
 * A colour given a part name ("Body") is the customer's to choose: the shop offers it with the
 * colours of `partGroupId`, starting in the colour set here, each priced by its own add-on.
 */
export function ColoursEditor({
  value,
  onChange,
  partGroupId,
  onPartGroupId,
  filaments,
  groups,
  errors,
}: {
  value: ProductColourView[];
  onChange: (next: ProductColourView[]) => void;
  partGroupId: string;
  onPartGroupId: (id: string) => void;
  /** The filaments on the shelf a colour may be printed from. */
  filaments: readonly Filament[];
  groups: readonly OptionGroupView[];
  errors: Partial<Record<string, string>>;
}) {
  if (value.length === 0) return null;
  const colourGroups = groups.filter(
    (g) => g.kind === 'CHOICE' && g.values.some((v) => v.active && v.swatchHex),
  );
  const parted = value.some((c) => c.part);
  const partGroup = parted
    ? groups.find((g) => g.id === partGroupId)
    : undefined;
  // With parts, the colours they start in come from the colours customers pick from.
  const named = [
    ...new Map(
      (partGroup ? [partGroup] : groups)
        .flatMap((g) => g.values)
        .filter((v) => v.active && v.swatchHex)
        .map((v) => [v.label, v.swatchHex!]),
    ),
  ];
  const total = value.reduce((n, c) => n + (Number(c.grams) || 0), 0);
  const set = (i: number, patch: Partial<ProductColourView>) =>
    onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  // What customers see above a colour's choices until the owner renames it: its own colour.
  const startName = (c: ProductColourView, i: number) =>
    (value.length === 1
      ? 'Colour'
      : c.colour.trim()
        ? `${c.colour.trim()} part`
        : `Colour ${i + 1}`
    ).slice(0, PRODUCT_PART_NAME_MAX_LENGTH);
  // The colours customers choose in: by default the group whose colours are printed from the
  // filaments these rows use (its choices then start in the very same reels).
  const linkedGroup = () =>
    [...colourGroups]
      .sort(
        (a, b) =>
          value.filter((c) =>
            a.values.some(
              (v) => v.stockItemId && v.stockItemId === c.stockItemId,
            ),
          ).length -
          value.filter((c) =>
            b.values.some(
              (v) => v.stockItemId && v.stockItemId === c.stockItemId,
            ),
          ).length,
      )
      .at(-1);
  const choose = (next: ProductColourView[]) => {
    onChange(next);
    const group = linkedGroup();
    if (next.some((c) => c.part !== null) && !partGroupId && group)
      onPartGroupId(group.id);
  };
  const choices = (partGroup?.values ?? []).filter(
    (v) => v.active && v.swatchHex,
  );
  const every = value.every((c) => c.part !== null);
  const listError = Object.entries(errors).find(
    ([k]) => k.startsWith('colours') || k.startsWith('partColourGroupId'),
  )?.[1];

  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">
        Colours ({total.toFixed(1)} g in all)
      </legend>
      <p className="text-sm text-text-muted">
        One card per colour in the file. <strong>Printed from</strong> is the
        reel its cost and stock come from. Tick{' '}
        <strong>Customers choose this colour</strong> to let them recolour that
        part in the shop; <strong>Starts as</strong> is the colour the shop
        shows first, in 3D and in the price.
      </p>
      {value.length > 1 && (
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            id="product-colour-choose-all"
            name="product-colour-choose-all"
            type="checkbox"
            checked={every}
            onChange={(e) => {
              const on = e.currentTarget.checked;
              choose(
                value.map((c, i) => ({
                  ...c,
                  part: on ? (c.part ?? startName(c, i)) : null,
                })),
              );
            }}
          />
          Customers choose every colour
        </label>
      )}
      <datalist id="product-colour-names">
        {named.map(([label]) => (
          <option key={label} value={label} />
        ))}
      </datalist>
      {value.map((c, i) => (
        <div
          key={`${c.hex}-${i}`}
          className="grid grid-cols-[auto_minmax(0,1fr)_6rem_auto] items-center gap-2 rounded-md border border-border p-3"
        >
          <Swatch
            hex={
              filaments.find((f) => f.id === c.stockItemId)?.swatchHex ??
              named.find(([l]) => l === c.colour)?.[1] ??
              c.hex
            }
          />
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
            className="min-w-0 rounded-md border border-border bg-surface px-2 py-1 text-right text-sm tabular-nums"
          />
          <Button
            variant="quiet"
            aria-label={`Remove colour ${i + 1}`}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            ×
          </Button>
          {filaments.length > 0 && (
            <span className="col-start-2 text-xs text-text-muted" aria-hidden>
              Printed from
            </span>
          )}
          {filaments.length > 0 && (
            <select
              id={`product-colour-filament-${i}`}
              name={`product-colour-filament-${i}`}
              aria-label={`Filament colour ${i + 1} is printed from`}
              value={c.stockItemId ?? ''}
              onChange={(e) => {
                const filament = filaments.find(
                  (f) => f.id === e.currentTarget.value,
                );
                // Printed from a filament on the shelf: it goes by that filament's name, so
                // stock takes its grams there and its cost uses that filament's price.
                set(
                  i,
                  filament
                    ? { stockItemId: filament.id, colour: filament.colour }
                    : { stockItemId: null },
                );
              }}
              className="col-span-3 col-start-2 min-w-0 rounded-md border border-border bg-surface px-2 py-1 text-sm"
            >
              <option value="">
                The product&apos;s material, by colour name
              </option>
              {filaments.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.material} · {f.colour} (${f.costPerGram}/g)
                </option>
              ))}
            </select>
          )}
          <label className="col-span-3 col-start-2 flex items-center gap-2 text-sm">
            <input
              id={`product-colour-choose-${i}`}
              name={`product-colour-choose-${i}`}
              type="checkbox"
              checked={c.part !== null}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                choose(
                  value.map((x, j) =>
                    j === i ? { ...x, part: on ? startName(x, i) : null } : x,
                  ),
                );
              }}
            />
            Customers choose this colour
          </label>
          {c.part !== null && (
            <span className="col-start-2 text-xs text-text-muted" aria-hidden>
              What customers call it
            </span>
          )}
          {c.part !== null && (
            <input
              id={`product-colour-part-${i}`}
              name={`product-colour-part-${i}`}
              aria-label={`What customers call colour ${i + 1}`}
              autoComplete="off"
              maxLength={PRODUCT_PART_NAME_MAX_LENGTH}
              placeholder="e.g. Body, Ears"
              value={c.part}
              onChange={(e) => set(i, { part: e.currentTarget.value })}
              className="col-span-3 col-start-2 min-w-0 rounded-md border border-border bg-surface px-2 py-1 text-sm"
            />
          )}
          {c.part !== null && choices.length > 0 && (
            <span className="col-start-2 text-xs text-text-muted" aria-hidden>
              Starts as (shown first in the shop)
            </span>
          )}
          {c.part !== null && choices.length > 0 && (
            <select
              id={`product-colour-start-${i}`}
              name={`product-colour-start-${i}`}
              aria-label={`Colour ${i + 1} starts as`}
              autoComplete="off"
              value={
                c.startsAs && choices.some((v) => v.label === c.startsAs)
                  ? c.startsAs
                  : ''
              }
              onChange={(e) =>
                set(i, { startsAs: e.currentTarget.value || null })
              }
              className="col-span-3 col-start-2 min-w-0 rounded-md border border-border bg-surface px-2 py-1 text-sm"
            >
              <option value="">
                Automatic:{' '}
                {startingChoice(choices, { ...c, startsAs: null })?.label} (its
                filament, or the closest colour)
              </option>
              {choices.map((v) => (
                <option key={v.id} value={v.label}>
                  {v.label}
                </option>
              ))}
            </select>
          )}
        </div>
      ))}
      {parted && (
        <SelectField
          label="Colours customers choose parts in"
          name="partColourGroupId"
          value={partGroupId}
          onChange={(e) => onPartGroupId(e.currentTarget.value)}
          hint="An option group with colour swatches (Options page); each colour's add-on is added to the price"
        >
          {colourGroups.length === 0 && (
            <option value="">No group has swatches yet</option>
          )}
          {colourGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </SelectField>
      )}
      {listError && <p className="text-sm text-danger">{listError}</p>}
    </fieldset>
  );
}
