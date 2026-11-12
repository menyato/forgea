import type { MaterialView, OptionValueView } from '@forgea/types';
import { useState } from 'react';
import { useFetcher, useLocation } from 'react-router';
import { Button } from '~/components/ui/button';
import { CheckboxField, Field, SelectField } from '~/components/ui/field';
import { SaveStatus } from '~/features/admin/admin-ui';
import type { SaveResult } from '~/features/admin/staff.server';
import { DeleteRecord } from '~/features/admin/delete-record';

/** One choice of a list and its price rules, or (without `value`) a new one. */
export function ValueForm({
  value,
  materials,
  filaments,
}: {
  value?: OptionValueView;
  materials: readonly MaterialView[];
  /** The filaments on the shelf a colour may be printed from. */
  filaments: readonly { id: string; material: string; colour: string }[];
}) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  const [swatch, setSwatch] = useState(
    value !== undefined && value.swatchHex !== null,
  );
  const here = useLocation().pathname;
  return (
    <>
      <fetcher.Form
        method="post"
        // A fresh form after adding, so the next choice starts empty.
        key={!value && fetcher.data?.ok ? 'reset' : 'form'}
        className={`grid gap-3 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-4 ${
          value ? 'border-border' : 'border-dashed border-border'
        }`}
      >
        <input type="hidden" name="intent" value="value" />
        {value && <input type="hidden" name="valueId" value={value.id} />}
        <Field
          label={value ? 'Choice' : 'New choice'}
          name="label"
          required
          defaultValue={value?.label}
          error={errors['label']}
        />
        <div className="grid gap-1.5">
          <CheckboxField
            label="Colour swatch"
            name="hasSwatch"
            checked={swatch}
            onChange={(e) => setSwatch(e.currentTarget.checked)}
          />
          {swatch && (
            <input
              type="color"
              name="swatchHex"
              aria-label="Swatch colour"
              autoComplete="off"
              defaultValue={value?.swatchHex ?? '#b87333'}
              className="h-9 w-full rounded-md border border-border bg-surface"
            />
          )}
        </div>
        <Field
          label="Material × (grams)"
          name="gramsMultiplier"
          inputMode="decimal"
          defaultValue={value?.gramsMultiplier ?? '1'}
          error={errors['gramsMultiplier']}
          hint="1 = same; 1.8 = 80% more material"
        />
        <Field
          label="Print time ×"
          name="hoursMultiplier"
          inputMode="decimal"
          defaultValue={value?.hoursMultiplier ?? '1'}
          error={errors['hoursMultiplier']}
          hint="1 = same; 1.5 = half as long again"
        />
        <Field
          label="Extra price (USD)"
          name="extraPrice"
          inputMode="decimal"
          defaultValue={value?.extraPrice ?? '0'}
          error={errors['extraPrice']}
          hint="Added to the final price"
        />
        <SelectField
          label="Prints in material"
          name="materialId"
          defaultValue={value?.materialId ?? ''}
          error={errors['materialId']}
          hint="Only for a Material option"
        >
          <option value="">No change</option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.code})
            </option>
          ))}
        </SelectField>
        {filaments.length > 0 && (
          <SelectField
            label="Printed from filament"
            name="stockItemId"
            defaultValue={value?.stockItemId ?? ''}
            error={errors['stockItemId']}
            hint="For a colour: orders that choose it take their grams from this reel"
          >
            <option value="">By the colour&apos;s name</option>
            {filaments.map((f) => (
              <option key={f.id} value={f.id}>
                {f.material} · {f.colour}
              </option>
            ))}
          </SelectField>
        )}
        <Field
          label="Order"
          name="sortOrder"
          type="number"
          min={0}
          defaultValue={value?.sortOrder ?? 0}
        />
        <CheckboxField
          label="Offered"
          name="active"
          defaultChecked={value?.active ?? true}
        />
        <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
          <Button
            type="submit"
            variant={value ? 'secondary' : 'primary'}
            disabled={fetcher.state !== 'idle'}
          >
            {value ? 'Save choice' : 'Add choice'}
          </Button>
          <SaveStatus state={fetcher.state} result={fetcher.data} />
        </div>
      </fetcher.Form>
      {value && (
        <DeleteRecord
          kind="optionValue"
          id={value.id}
          what={value.label}
          back={here}
        />
      )}
    </>
  );
}
