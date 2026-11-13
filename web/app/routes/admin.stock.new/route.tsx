import type { MaterialView } from '@forgea/types';
import { CreateStockItemDto } from '@forgea/validation';
import { redirect, useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { CheckboxField, Field, SelectField } from '~/components/ui/field';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import {
  checked,
  type SaveResult,
  save,
  text,
} from '~/features/admin/staff.server';
import { ColourLook } from '~/features/stock/stock-ui';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ context }: Route.LoaderArgs) {
  const materials = await context
    .get(apiContext)
    .get<MaterialView[]>('/materials');
  if (!materials.ok)
    throw new Response(materials.message, { status: materials.status });
  return { materials: materials.data.filter((m) => m.active) };
}

/** A new filament on the shelf, with nothing on it yet; opens its page. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  let createdId: string | undefined;
  const result = await save(
    CreateStockItemDto,
    {
      materialId: text(form, 'materialId'),
      colour: text(form, 'colour'),
      hex: text(form, 'hex'),
      spoolPrice: text(form, 'spoolPrice') || undefined,
      lowStockGrams: text(form, 'lowStockGrams'),
      spoolGrams: text(form, 'spoolGrams'),
      leadTimeDays: text(form, 'leadTimeDays'),
      coverDays: text(form, 'coverDays'),
      active: checked(form, 'active'),
    },
    async (dto) => {
      const r = await context
        .get(apiContext)
        .post<{ id: string }>('/stock/items', dto);
      if (r.ok) createdId = r.data.id;
      return r;
    },
  );
  if (createdId) throw redirect(`/admin/stock/${createdId}`);
  return result;
}

export default function NewFilament({ loaderData }: Route.ComponentProps) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <>
      <AdminHeader
        title="New filament"
        intro="A filament as you buy it (PLA Red, PETG Black…), before its spools come in: record them later with Spools received or a vendor bill."
        trail={[{ label: 'Filament stock', to: '/admin/stock' }]}
      />
      <Panel title="The filament">
        <fetcher.Form
          method="post"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <SelectField
            label="Material"
            name="materialId"
            required
            defaultValue=""
            error={errors['materialId']}
          >
            <option value="" disabled>
              Choose…
            </option>
            {loaderData.materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </SelectField>
          <Field
            label="Name as bought"
            name="colour"
            required
            maxLength={40}
            placeholder="e.g. Elegoo PLA+ (Red)"
            error={errors['colour']}
            hint="Product colours pick it by this name"
          />
          <ColourLook initial={null} />
          <Field
            label="Price of one spool (USD, optional)"
            name="spoolPrice"
            inputMode="decimal"
            placeholder="e.g. 19.50"
            error={errors['spoolPrice']}
            hint="Empty: the material's price per gram"
          />
          <Field
            label="Spool size (g)"
            name="spoolGrams"
            type="number"
            min={1}
            defaultValue={1000}
            error={errors['spoolGrams']}
          />
          <Field
            label="Low level (g)"
            name="lowStockGrams"
            type="number"
            min={0}
            defaultValue={200}
            error={errors['lowStockGrams']}
            hint="Keep at least this much"
          />
          <Field
            label="Delivery takes (days)"
            name="leadTimeDays"
            type="number"
            min={0}
            defaultValue={7}
            error={errors['leadTimeDays']}
          />
          <Field
            label="Buy enough for (days)"
            name="coverDays"
            type="number"
            min={0}
            defaultValue={30}
            error={errors['coverDays']}
          />
          <div className="sm:col-span-2">
            <CheckboxField
              label="Track this filament"
              name="active"
              defaultChecked
              hint="Flagged when it runs low."
            />
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={fetcher.state !== 'idle'}>
              Add filament
            </Button>
            <SaveStatus state={fetcher.state} result={fetcher.data} />
          </div>
        </fetcher.Form>
      </Panel>
    </>
  );
}
