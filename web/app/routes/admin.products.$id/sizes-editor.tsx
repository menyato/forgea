import {
  formatSizeCm,
  type ProductSizeView,
  scaledSize,
  type SizeCm,
} from '@forgea/types';
import { PRODUCT_SIZES_MAX } from '@forgea/validation/constants';
import { useState } from 'react';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';

const AXES = [
  ['x', 'Width'],
  ['y', 'Depth'],
  ['z', 'Height'],
] as const;

const EMPTY: SizeCm = { x: '', y: '', z: '' };

/** "Small / Standard / Large" in one click: heights as a share of the measured one. */
const PRESETS: [label: string, share: number][] = [
  ['Small', 0.75],
  ['Standard', 1],
  ['Large', 1.3],
];

/**
 * The product's printed size and the real sizes it is sold in. The measured size is what the
 * grams and print time are for (the 3D model fills it in); each size has its own
 * measurements, grams and hours, and the customer sees its measurements when choosing.
 * A new size needs one measurement: the rest follows the model's proportions, and grams and
 * hours are suggested from the volume; every box stays editable.
 */
export function SizesEditor({
  measured,
  onMeasured,
  sizes,
  onSizes,
  grams,
  printHours,
  errors,
}: {
  measured: SizeCm;
  onMeasured: (size: SizeCm) => void;
  sizes: ProductSizeView[];
  onSizes: (sizes: ProductSizeView[]) => void;
  grams: string;
  printHours: string;
  errors: Partial<Record<string, string>>;
}) {
  const [label, setLabel] = useState('');
  const [height, setHeight] = useState('');
  const base =
    Number(measured.x) > 0 &&
    Number(measured.y) > 0 &&
    Number(measured.z) > 0 &&
    Number(grams) > 0 &&
    Number(printHours) > 0
      ? { size: measured, grams, printHours }
      : null;
  const full = sizes.length >= PRODUCT_SIZES_MAX;

  const add = (name: string, cm: number) => {
    if (!base || !(cm > 0) || full) return;
    const scaled = scaledSize(base, 'z', cm);
    // The name is the owner's own; without one, the size goes by its measurements.
    const label = name.trim() || formatSizeCm(scaled.size);
    if (sizes.some((s) => s.label.toLowerCase() === label.toLowerCase()))
      return;
    onSizes([
      ...sizes,
      {
        label,
        ...scaled,
        isDefault: sizes.length === 0,
      },
    ]);
  };
  const change = (i: number, patch: Partial<ProductSizeView>) =>
    onSizes(sizes.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const sizeError = Object.entries(errors).find(([k]) =>
    k.startsWith('sizes'),
  )?.[1];

  return (
    <div className="grid gap-5">
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">
          Printed size, cm (what the grams and time above are for)
        </legend>
        <div className="grid grid-cols-3 gap-2">
          {AXES.map(([axis, name]) => (
            <Field
              key={axis}
              label={name}
              name={`size-${axis}`}
              inputMode="decimal"
              value={measured[axis]}
              onChange={(e) =>
                onMeasured({ ...measured, [axis]: e.currentTarget.value })
              }
              error={errors[`size${axis.toUpperCase()}cm`]}
            />
          ))}
        </div>
        <p className="text-xs text-text-muted">
          &ldquo;Use these numbers&rdquo; under the 3D model fills this in from
          the model.
        </p>
      </fieldset>

      <div className="grid gap-3">
        <p className="text-sm font-medium">
          Sizes customers choose{' '}
          <span className="font-normal text-text-muted">
            (none: it comes in the size above). Customers choose by the
            measurements; the names are only for you.
          </span>
        </p>
        {sizes.map((s, i) => (
          <fieldset
            key={s.id ?? `new-${i}`}
            className="grid gap-2 rounded-md border border-border p-3"
          >
            <legend className="sr-only">Size {s.label}</legend>
            {/* Stacked, so a row fits the narrow form column on any screen. */}
            <Field
              label="Name (for you)"
              name={`sizes-${i}-label`}
              value={s.label}
              onChange={(e) => change(i, { label: e.currentTarget.value })}
            />
            <div className="grid grid-cols-3 gap-2">
              {AXES.map(([axis, name]) => (
                <Field
                  key={axis}
                  label={`${name} cm`}
                  name={`sizes-${i}-${axis}`}
                  inputMode="decimal"
                  value={s.size[axis]}
                  onChange={(e) =>
                    change(i, {
                      size: { ...s.size, [axis]: e.currentTarget.value },
                    })
                  }
                />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field
                label="Grams"
                name={`sizes-${i}-grams`}
                inputMode="decimal"
                value={s.grams}
                onChange={(e) => change(i, { grams: e.currentTarget.value })}
              />
              <Field
                label="Hours"
                name={`sizes-${i}-hours`}
                inputMode="decimal"
                value={s.printHours}
                onChange={(e) =>
                  change(i, { printHours: e.currentTarget.value })
                }
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="default-size"
                  checked={s.isDefault}
                  onChange={() =>
                    onSizes(sizes.map((x, j) => ({ ...x, isDefault: j === i })))
                  }
                />
                default
              </label>
              <Button
                variant="quiet"
                onClick={() => onSizes(sizes.filter((_, j) => j !== i))}
                aria-label={`Remove size ${s.label}`}
              >
                Remove
              </Button>
            </div>
          </fieldset>
        ))}
        {sizeError && <p className="text-sm text-danger">{sizeError}</p>}

        {base ? (
          <div className="grid gap-3 rounded-md border border-dashed border-border p-3">
            <div className="flex flex-wrap items-end gap-2">
              <Field
                label="Name (optional)"
                name="new-size-label"
                placeholder="e.g. Large"
                value={label}
                onChange={(e) => setLabel(e.currentTarget.value)}
              />
              <Field
                label="Its height, cm"
                name="new-size-height"
                inputMode="decimal"
                placeholder={measured.z}
                value={height}
                onChange={(e) => setHeight(e.currentTarget.value)}
              />
              <Button
                variant="secondary"
                disabled={full}
                onClick={() => {
                  add(label, Number(height));
                  setLabel('');
                  setHeight('');
                }}
              >
                Add the size
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-text-muted">Or in one click:</span>
              <Button
                variant="quiet"
                disabled={full}
                onClick={() => {
                  // Built in one go, so each one sees the ones before it.
                  const next = [...sizes];
                  for (const [name, share] of PRESETS) {
                    if (
                      next.some(
                        (s) => s.label.toLowerCase() === name.toLowerCase(),
                      )
                    )
                      continue;
                    if (next.length >= PRODUCT_SIZES_MAX) break;
                    next.push({
                      label: name,
                      ...scaledSize(base, 'z', Number(measured.z) * share),
                      isDefault: false,
                    });
                  }
                  const standard = next.findIndex(
                    (s) => s.label === 'Standard',
                  );
                  const pick = standard >= 0 ? standard : 0;
                  onSizes(
                    next.some((s) => s.isDefault)
                      ? next
                      : next.map((s, j) => ({ ...s, isDefault: j === pick })),
                  );
                }}
              >
                Small, Standard and Large
              </Button>
            </div>
            <p className="text-xs text-text-muted">
              Width and depth follow the model&rsquo;s proportions; grams and
              hours grow with the volume. Check them against your slicer and
              change any box.
            </p>
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            Fill in the printed size, grams and print time first: new sizes are
            worked out from them.
          </p>
        )}
      </div>
    </div>
  );
}

export { EMPTY as NO_SIZE };
