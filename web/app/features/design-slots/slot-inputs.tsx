import type { SlotChoice } from '@forgea/text3d/design';
import { nearestColour, slotState } from '@forgea/text3d/design';
import type { CustomerLogoView, ProductSlotsOffer } from '@forgea/types';
import { OwnLogoField } from '~/features/own-logo/own-logo-field';
import {
  fontFamilyOf,
  useFontFaces,
} from '~/features/text-studio/use-font-faces';

/**
 * What a customer may change on a product's text and logos: the owner's editable slots only
 * (their text, font and colour; a logo on or off, or their own logo instead). The rest prints
 * as the owner set it.
 */
export function SlotInputs({
  offer,
  choices,
  onChange,
  onLogo,
}: {
  offer: ProductSlotsOffer;
  choices: Readonly<Record<string, SlotChoice>>;
  onChange: (next: Record<string, SlotChoice>) => void;
  /** A logo the customer brought: the page shows it in 3D. */
  onLogo: (logo: CustomerLogoView) => void;
}) {
  useFontFaces(offer.fonts);
  const editable = offer.slots.filter((s) => s.editable);
  if (editable.length === 0) return null;
  const set = (id: string, patch: SlotChoice) =>
    onChange({ ...choices, [id]: { ...choices[id], ...patch } });
  return (
    <section aria-labelledby="personalise" className="grid gap-4">
      <h2 id="personalise" className="font-display text-lg font-bold">
        Make it yours
      </h2>
      {editable.map((s) => {
        const state = slotState(s, choices[s.id]);
        const field = `slot-${s.id}`;
        return (
          <fieldset key={s.id} className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{s.label}</legend>
            {s.kind === 'TEXT' ? (
              <>
                <input
                  id={field}
                  name={field}
                  aria-label={s.label}
                  autoComplete="off"
                  maxLength={s.maxChars ?? 40}
                  placeholder={s.defaultText || 'Type it here'}
                  value={choices[s.id]?.text ?? s.defaultText ?? ''}
                  onChange={(e) => set(s.id, { text: e.currentTarget.value })}
                  className="rounded-md border border-border bg-surface px-3 py-2"
                />
                {offer.fonts.length > 1 && (
                  <select
                    id={`${field}-font`}
                    name={`${field}-font`}
                    aria-label={`${s.label}: font`}
                    autoComplete="off"
                    value={state.fontId}
                    onChange={(e) =>
                      set(s.id, { fontId: e.currentTarget.value })
                    }
                    className="rounded-md border border-border bg-surface px-3 py-2"
                    style={{ fontFamily: fontFamilyOf(state.fontId) }}
                  >
                    {offer.fonts.map((f) => (
                      <option
                        key={f.id}
                        value={f.id}
                        style={{ fontFamily: fontFamilyOf(f.id) }}
                      >
                        {f.name}
                      </option>
                    ))}
                  </select>
                )}
              </>
            ) : (
              <>
                {state.logoId && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      id={field}
                      name={field}
                      type="checkbox"
                      checked={state.on}
                      onChange={(e) =>
                        set(s.id, { on: e.currentTarget.checked })
                      }
                    />
                    Show the logo
                  </label>
                )}
                <OwnLogoField
                  label={
                    s.logoId ? 'Or put your own logo here' : 'Add your logo'
                  }
                  onLogo={(logo) => {
                    onLogo(logo);
                    // A logo in colours starts in them, each the closest filament.
                    const logoColours = logo.inks?.map(
                      (ink) =>
                        nearestColour(ink.hex, offer.colours)?.id ??
                        state.colour,
                    );
                    set(s.id, {
                      logoId: logo.id,
                      on: true,
                      logoColours,
                    });
                  }}
                />
                <LogoColours
                  field={field}
                  label={s.label}
                  inks={
                    offer.logos.find((l) => l.id === state.logoId)?.inks ?? null
                  }
                  colours={offer.colours}
                  chosen={state.logoColours}
                  fallback={state.colour}
                  onChange={(logoColours) => set(s.id, { logoColours })}
                />
              </>
            )}
            {offer.colours.length > 1 && !state.logoColours?.length && (
              <div
                role="radiogroup"
                aria-label={`${s.label}: colour`}
                className="flex flex-wrap gap-2"
              >
                {offer.colours.map((c) => (
                  <label
                    key={c.id}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-pill border px-2.5 py-1 text-sm ${
                      state.colour === c.id ? 'border-accent' : 'border-border'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`${field}-colour`}
                      value={c.id}
                      checked={state.colour === c.id}
                      onChange={() => set(s.id, { colour: c.id })}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className="size-4 rounded-full border border-border"
                      style={{ backgroundColor: c.swatchHex ?? undefined }}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        );
      })}
    </section>
  );
}

/**
 * A logo in more than one colour: print it in its own colours (a filament for each, the
 * closest to start) or in one.
 */
function LogoColours({
  field,
  label,
  inks,
  colours,
  chosen,
  fallback,
  onChange,
}: {
  field: string;
  label: string;
  inks: { hex: string }[] | null;
  colours: ProductSlotsOffer['colours'];
  chosen: string[] | undefined;
  fallback: string;
  onChange: (logoColours: string[] | undefined) => void;
}) {
  if (!inks || inks.length < 2 || colours.length < 2) return null;
  const on = chosen?.length === inks.length;
  const current = inks.map(
    (ink, i) =>
      (on ? chosen[i] : undefined) ??
      nearestColour(ink.hex, colours)?.id ??
      fallback,
  );
  return (
    <div className="grid gap-2">
      <label className="flex items-center gap-2 text-sm">
        <input
          id={`${field}-in-colour`}
          name={`${field}-in-colour`}
          type="checkbox"
          autoComplete="off"
          checked={on}
          onChange={(e) =>
            onChange(e.currentTarget.checked ? current : undefined)
          }
        />
        Print the logo in its own colours
      </label>
      {on &&
        inks.map((ink, i) => (
          <div
            key={i}
            role="radiogroup"
            aria-label={`${label}: logo colour ${i + 1}`}
            className="flex flex-wrap items-center gap-2"
          >
            <span
              title="In your logo"
              aria-hidden="true"
              className="size-4 rounded-full border border-border"
              style={{ backgroundColor: ink.hex }}
            />
            <span className="text-sm text-text-muted">→</span>
            {colours.map((c) => (
              <label
                key={c.id}
                title={c.label}
                className={`flex cursor-pointer items-center gap-1.5 rounded-pill border px-2.5 py-1 text-sm ${
                  current[i] === c.id ? 'border-accent' : 'border-border'
                }`}
              >
                <input
                  type="radio"
                  name={`${field}-logo-colour-${i}`}
                  value={c.id}
                  checked={current[i] === c.id}
                  onChange={() => {
                    const next = [...current];
                    next[i] = c.id;
                    onChange(next);
                  }}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className="size-4 rounded-full border border-border"
                  style={{ backgroundColor: c.swatchHex ?? undefined }}
                />
                {c.label}
              </label>
            ))}
          </div>
        ))}
    </div>
  );
}

/** The choices as the API takes them (one entry per slot chosen). */
export const slotChoicesJson = (
  choices: Readonly<Record<string, SlotChoice>>,
): string =>
  JSON.stringify(
    Object.entries(choices).map(([slotId, c]) => ({ slotId, ...c })),
  );
