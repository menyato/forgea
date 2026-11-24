import {
  ACCENT_STYLES,
  BOARD_STYLES,
  KEYCHAIN_SHAPE_LABELS,
  KEYCHAIN_SHAPES,
  TEXT_DECOR_LABELS,
  TEXT_DECORS,
  TEXT_STYLE_LABELS,
  TEXT_STYLES,
} from '@forgea/text3d/design';
import type {
  LogoView,
  OptionGroupView,
  ProductTextSettings,
} from '@forgea/types';
import { useState } from 'react';
import { CheckboxField, Field, SelectField } from '~/components/ui/field';

/** Sensible starting settings for each style; the owner changes any of them. */
const STARTS: Record<
  ProductTextSettings['style'],
  Omit<
    ProductTextSettings,
    | 'style'
    | 'colourGroupId'
    | 'defaultColourId'
    | 'defaultBaseColourId'
    | 'defaultAccentColourId'
    | 'decor'
    | 'shapes'
    | 'logoIds'
    | 'ownLogo'
  >
> = {
  KEYCHAIN: {
    maxChars: 12,
    letterHeightMm: '10',
    letterDepthMm: '1.6',
    baseDepthMm: '2.4',
    maxWidthMm: '75',
    extraColourPrice: '1.00',
    sizesMm: ['13', '16'],
  },
  NAME: {
    maxChars: 12,
    letterHeightMm: '30',
    letterDepthMm: '6',
    baseDepthMm: '3',
    maxWidthMm: '220',
    extraColourPrice: '2.00',
    sizesMm: ['40', '50'],
  },
  MONOGRAM: {
    maxChars: 3,
    letterHeightMm: '40',
    letterDepthMm: '5',
    baseDepthMm: '3',
    maxWidthMm: '160',
    extraColourPrice: '1.50',
    sizesMm: ['60', '80'],
  },
  LETTERS: {
    maxChars: 10,
    letterHeightMm: '50',
    letterDepthMm: '8',
    baseDepthMm: '3',
    maxWidthMm: '400',
    extraColourPrice: '1.00',
    sizesMm: ['80', '100'],
  },
  INITIAL_NAME: {
    maxChars: 12,
    letterHeightMm: '80',
    letterDepthMm: '4',
    baseDepthMm: '3',
    maxWidthMm: '200',
    extraColourPrice: '2.00',
    sizesMm: ['100', '120'],
  },
  COUPLE: {
    maxChars: 10,
    letterHeightMm: '30',
    letterDepthMm: '5',
    baseDepthMm: '3',
    maxWidthMm: '250',
    extraColourPrice: '2.00',
    sizesMm: ['40'],
  },
  STANDING_INITIAL: {
    maxChars: 1,
    letterHeightMm: '150',
    letterDepthMm: '2',
    baseDepthMm: '20',
    maxWidthMm: '200',
    extraColourPrice: '2.00',
    sizesMm: ['120', '180'],
  },
  TROPHY: {
    maxChars: 1,
    letterHeightMm: '140',
    letterDepthMm: '2',
    baseDepthMm: '6',
    maxWidthMm: '200',
    extraColourPrice: '2.00',
    sizesMm: ['180'],
  },
};

const HELP: Record<ProductTextSettings['style'], string> = {
  KEYCHAIN:
    'Raised letters on a backing that follows them, with a ring at the start (the right for Arabic).',
  NAME: 'A big name on one backing, so its letters and dots stand as one piece.',
  MONOGRAM:
    'Up to 3 initials curving together, the middle one larger; each letter its own font and colour.',
  LETTERS:
    'Each letter a separate piece with its own backing, in its own font and colour.',
  INITIAL_NAME:
    "The name's first letter big, the whole name across it and decorations around it, standing. The size is the initial's height.",
  COUPLE:
    'Two names with a heart between them on one backing, standing. Most characters is per name.',
  STANDING_INITIAL:
    "One big letter that stands on its own; customers place names, dates, weights, decorations and logos on it where they like (drag and drop). The size is the letter's height; the thickness is the backing.",
  TROPHY:
    "A plaque on a foot; customers place a title, names, a year, decorations and logos (a profession's, or their own) on it where they like. The size is the plaque's height.",
};

/**
 * Personalised text: the customer types, picks fonts (Dashboard → Fonts) and colours, and
 * sees the piece in 3D. The piece's grams and hours come from its volume, priced like any
 * product; grams and print time above only set the "from" price shown in the shop.
 */
export function TextSettingsPanel({
  value,
  onChange,
  groups,
  logos,
  errors,
}: {
  value: ProductTextSettings | null;
  onChange: (next: ProductTextSettings | null) => void;
  groups: readonly OptionGroupView[];
  /** The studio's logos a keychain may offer. */
  logos: readonly LogoView[];
  errors: Partial<Record<string, string>>;
}) {
  const colourGroups = groups.filter((g) => g.values.some((v) => v.swatchHex));
  const set = (patch: Partial<ProductTextSettings>) =>
    value && onChange({ ...value, ...patch });
  const error = Object.entries(errors).find(([k]) => k.startsWith('text'))?.[1];
  // As typed ("13, 16"), so a comma being typed isn't lost.
  const [sizesText, setSizesText] = useState((value?.sizesMm ?? []).join(', '));
  const groupColours =
    groups
      .find((g) => g.id === value?.colourGroupId)
      ?.values.filter((v) => v.active) ?? [];
  return (
    <div className="grid gap-4">
      <CheckboxField
        label="Customers design their own text"
        name="text-on"
        checked={value !== null}
        onChange={(e) =>
          onChange(
            e.currentTarget.checked
              ? {
                  style: 'KEYCHAIN',
                  colourGroupId: colourGroups[0]?.id ?? '',
                  defaultColourId: null,
                  defaultBaseColourId: null,
                  defaultAccentColourId: null,
                  decor: null,
                  shapes: [],
                  logoIds: [],
                  ownLogo: false,
                  ...STARTS.KEYCHAIN,
                }
              : null,
          )
        }
        hint="A name keychain, a standing name, curved initials, single letters, a big initial with the name, or two names and a heart, in Arabic or English"
      />
      {value && (
        <>
          <SelectField
            label="What it is"
            name="text-style"
            value={value.style}
            onChange={(e) => {
              const style = e.currentTarget
                .value as ProductTextSettings['style'];
              onChange({
                ...value,
                style,
                ...STARTS[style],
                decor:
                  style === 'INITIAL_NAME'
                    ? (value.decor ?? 'HEARTS')
                    : style === 'STANDING_INITIAL'
                      ? value.decor
                      : null,
                // Shapes belong to keychains; logos to them and to pieces designed freely.
                shapes: style === 'KEYCHAIN' ? value.shapes : [],
                logoIds: takesLogos(style) ? value.logoIds : [],
                ownLogo: takesLogos(style) ? value.ownLogo : false,
              });
              setSizesText(STARTS[style].sizesMm.join(', '));
            }}
            hint={HELP[value.style]}
          >
            {TEXT_STYLES.map((s) => (
              <option key={s} value={s}>
                {TEXT_STYLE_LABELS[s]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Colours customers choose from"
            name="text-colour-group"
            value={value.colourGroupId}
            onChange={(e) => set({ colourGroupId: e.currentTarget.value })}
            hint="An option group with colour swatches (Options page)"
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
          {value.style === 'KEYCHAIN' && (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">
                Shapes customers choose from
              </legend>
              <p className="text-sm text-text-muted">
                The plate follows the letters unless you offer shapes here.
              </p>
              <div className="flex flex-wrap gap-3">
                {KEYCHAIN_SHAPES.filter((s) => s !== 'OUTLINE').map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name={`text-shape-${s}`}
                      checked={value.shapes.includes(s)}
                      onChange={(e) =>
                        set({
                          shapes: e.currentTarget.checked
                            ? [...value.shapes, s]
                            : value.shapes.filter((x) => x !== s),
                        })
                      }
                    />
                    {KEYCHAIN_SHAPE_LABELS[s]}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {takesLogos(value.style) && (
            <CheckboxField
              label="Customers may bring their own logo"
              name="text-own-logo"
              checked={value.ownLogo}
              onChange={(e) => set({ ownLogo: e.currentTarget.checked })}
              hint="They drop a picture or an SVG; it is traced into a raised logo, beside their name or alone"
            />
          )}
          {takesLogos(value.style) && logos.some((l) => l.active) && (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">
                {value.style === 'KEYCHAIN'
                  ? 'Logos customers may add beside their name'
                  : 'Logos customers may place on it'}
              </legend>
              <div className="flex flex-wrap gap-3">
                {logos
                  .filter((l) => l.active || value.logoIds.includes(l.id))
                  .map((l) => (
                    <label
                      key={l.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        name={`text-logo-${l.id}`}
                        checked={value.logoIds.includes(l.id)}
                        onChange={(e) =>
                          set({
                            logoIds: e.currentTarget.checked
                              ? [...value.logoIds, l.id]
                              : value.logoIds.filter((x) => x !== l.id),
                          })
                        }
                      />
                      {l.name}
                    </label>
                  ))}
              </div>
            </fieldset>
          )}
          {value.style === 'STANDING_INITIAL' && (
            <SelectField
              label="Looks it starts from"
              name="text-looks"
              value={value.decor ?? ''}
              onChange={(e) =>
                set({
                  decor: (e.currentTarget.value ||
                    null) as ProductTextSettings['decor'],
                })
              }
              hint="A girl's looks (hearts, flowers, butterflies) or a boy's (stars, moon, crown): the product page offers those, customers change anything after"
            >
              <option value="">Every look</option>
              <option value="HEARTS">A girl's looks</option>
              <option value="STARS">A boy's looks</option>
            </SelectField>
          )}
          {value.style === 'INITIAL_NAME' && (
            <SelectField
              label="Decorations"
              name="text-decor"
              value={value.decor ?? 'HEARTS'}
              onChange={(e) =>
                set({
                  decor: e.currentTarget.value as NonNullable<
                    ProductTextSettings['decor']
                  >,
                })
              }
              hint="Around the initial, in the accent colour: hearts or flowers for a baby girl, a moon and stars or a crown for a boy"
            >
              {TEXT_DECORS.map((d) => (
                <option key={d} value={d}>
                  {TEXT_DECOR_LABELS[d]}
                </option>
              ))}
            </SelectField>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field
              label="Most characters"
              name="text-max-chars"
              type="number"
              min={1}
              max={value.style === 'MONOGRAM' ? 3 : 24}
              value={value.maxChars}
              onChange={(e) =>
                set({ maxChars: Number(e.currentTarget.value) || 1 })
              }
            />
            <Field
              label="Letter height (mm)"
              name="text-height"
              inputMode="decimal"
              value={value.letterHeightMm}
              onChange={(e) => set({ letterHeightMm: e.currentTarget.value })}
            />
            <Field
              label="Letter thickness (mm)"
              name="text-depth"
              inputMode="decimal"
              value={value.letterDepthMm}
              onChange={(e) => set({ letterDepthMm: e.currentTarget.value })}
            />
            <Field
              label="Backing thickness (mm)"
              name="text-base"
              inputMode="decimal"
              value={value.baseDepthMm}
              onChange={(e) => set({ baseDepthMm: e.currentTarget.value })}
            />
            <Field
              label="Widest piece (mm)"
              name="text-width"
              inputMode="decimal"
              value={value.maxWidthMm}
              onChange={(e) => set({ maxWidthMm: e.currentTarget.value })}
              hint="Longer text is made smaller to fit"
            />
            <Field
              label="Each extra colour (USD)"
              name="text-extra-colour"
              inputMode="decimal"
              value={value.extraColourPrice}
              onChange={(e) => set({ extraColourPrice: e.currentTarget.value })}
            />
          </div>
          <Field
            label="More sizes customers can choose (letter height, mm)"
            name="text-sizes"
            value={sizesText}
            onChange={(e) => {
              setSizesText(e.currentTarget.value);
              set({
                sizesMm: e.currentTarget.value
                  .split(/[\s,]+/)
                  .map((x) => x.trim())
                  .filter(Boolean),
              });
            }}
            hint={`Separated by commas, e.g. 13, 16. The letter height above (${value.letterHeightMm} mm) is the default.`}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Letters start in"
              name="text-default-colour"
              value={value.defaultColourId ?? ''}
              onChange={(e) =>
                set({ defaultColourId: e.currentTarget.value || null })
              }
            >
              <option value="">The first colour</option>
              {groupColours.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Backing starts in"
              name="text-default-base"
              value={value.defaultBaseColourId ?? ''}
              onChange={(e) =>
                set({ defaultBaseColourId: e.currentTarget.value || null })
              }
            >
              <option value="">Same as the letters</option>
              {groupColours.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </SelectField>
            {ACCENT_STYLES.includes(value.style) && (
              <SelectField
                label={
                  value.style === 'COUPLE'
                    ? 'Heart starts in'
                    : 'Initial and decorations start in'
                }
                name="text-default-accent"
                value={value.defaultAccentColourId ?? ''}
                onChange={(e) =>
                  set({ defaultAccentColourId: e.currentTarget.value || null })
                }
              >
                <option value="">Same as the letters</option>
                {groupColours.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </SelectField>
            )}
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
        </>
      )}
    </div>
  );
}

/** Name keychains and pieces designed freely offer logos (the studio's, or the customer's). */
function takesLogos(style: ProductTextSettings['style']): boolean {
  return style === 'KEYCHAIN' || BOARD_STYLES.includes(style);
}
