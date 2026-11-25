import { nearestColour, type TextDecor } from '@forgea/text3d/design';
import type { ProductTextOffer } from '@forgea/types';
import { PrintingLogo } from '~/components/brand/printing-logo';

export const TEXT_INPUT =
  'w-full rounded-md border border-border bg-surface px-3 py-2.5 text-xl text-text aria-[invalid=true]:border-danger';

export function withLetter(
  all: { fontId?: string; colour?: string }[],
  i: number,
  patch: { fontId?: string | undefined; colour?: string | undefined },
) {
  const next = [...all];
  while (next.length <= i) next.push({});
  const merged: { fontId?: string; colour?: string } = { ...next[i] };
  if ('fontId' in patch) {
    if (patch.fontId) merged.fontId = patch.fontId;
    else delete merged.fontId;
  }
  if ('colour' in patch) {
    if (patch.colour) merged.colour = patch.colour;
    else delete merged.colour;
  }
  next[i] = merged;
  return next;
}

/** Colour swatches as a radio group; `same` adds "no colour of its own". */
export function Swatches({
  legend,
  name,
  colours,
  value,
  onChange,
  same,
  note,
  small = false,
}: {
  legend: string;
  name: string;
  colours: ProductTextOffer['colours'];
  value: string | null;
  onChange: (id: string | null) => void;
  same?: string;
  note?: React.ReactNode;
  small?: boolean;
}) {
  const size = small ? 'h-6 w-6' : 'h-8 w-8';
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">
        {legend}
        {value && (
          <span className="font-normal text-text-muted">
            : {colours.find((c) => c.id === value)?.label}
          </span>
        )}
      </legend>
      <div
        className="flex flex-wrap items-center gap-2"
        role="radiogroup"
        aria-label={legend}
      >
        {same && (
          <label className="relative cursor-pointer rounded-pill border border-border px-3 py-1 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/10">
            <input
              type="radio"
              name={name}
              className="sr-only"
              checked={value === null}
              onChange={() => onChange(null)}
            />
            {same}
          </label>
        )}
        {colours.map((c) => (
          <label
            key={c.id}
            title={c.label}
            className={`${size} relative cursor-pointer rounded-full border-2 border-border has-[:checked]:border-accent has-[:checked]:ring-2 has-[:checked]:ring-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus-ring`}
            style={{ backgroundColor: c.swatchHex ?? undefined }}
          >
            <input
              type="radio"
              name={name}
              className="sr-only"
              checked={value === c.id}
              onChange={() => onChange(c.id)}
              aria-label={c.label}
            />
          </label>
        ))}
      </div>
      {note && <p className="text-xs text-text-muted">{note}</p>}
    </fieldset>
  );
}

/** Ready-made looks for a baby's initial: colours (the shop's closest) and decorations. */
const LOOKS: {
  label: string;
  decor: TextDecor;
  accent: string;
  letters: string;
}[] = [
  {
    label: 'Baby girl',
    decor: 'BUTTERFLIES',
    accent: '#f4a6c1',
    letters: '#ffffff',
  },
  { label: 'Baby boy', decor: 'STARS', accent: '#6fb1e8', letters: '#ffffff' },
  {
    label: 'Little prince(ss)',
    decor: 'CROWN',
    accent: '#d4a72c',
    letters: '#ffffff',
  },
];

/** One tap sets the decorations and colours of a look; each stays changeable below. */
export function QuickLooks({
  colours,
  onPick,
}: {
  colours: ProductTextOffer['colours'];
  onPick: (look: {
    decor: TextDecor;
    accent: string | null;
    letters: string | null;
  }) => void;
}) {
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">Quick looks</span>
      <div className="flex flex-wrap gap-2">
        {LOOKS.map((look) => {
          const accent = nearestColour(look.accent, colours);
          const letters = nearestColour(look.letters, colours);
          return (
            <button
              key={look.label}
              type="button"
              onClick={() =>
                onPick({
                  decor: look.decor,
                  accent: accent?.id ?? null,
                  letters: letters?.id ?? null,
                })
              }
              className="flex items-center gap-2 rounded-pill border border-border px-3 py-1.5 text-sm hover:border-accent"
            >
              <span
                aria-hidden="true"
                className="size-4 rounded-full border border-border"
                style={{ backgroundColor: accent?.swatchHex ?? look.accent }}
              />
              {look.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Loading() {
  return (
    <div className="grid h-full place-content-center justify-items-center gap-3 text-sm text-text-muted">
      <PrintingLogo mode="loop" className="w-14" />
      Loading the 3D designer…
    </div>
  );
}
