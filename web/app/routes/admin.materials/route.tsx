import type { MaterialView } from '@forgea/types';
import { SaveMaterialDto } from '@forgea/validation';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { CheckboxField, Field } from '~/components/ui/field';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import {
  checked,
  type SaveResult,
  save,
  text,
} from '~/features/admin/staff.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ context }: Route.LoaderArgs) {
  const r = await context.get(apiContext).get<MaterialView[]>('/materials');
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { materials: r.data };
}

export async function action({ request, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const id = text(form, 'id');
  return save(
    SaveMaterialDto,
    {
      code: text(form, 'code')?.toUpperCase(),
      name: text(form, 'name'),
      pricePerGram: text(form, 'pricePerGram'),
      densityGPerCm3: text(form, 'densityGPerCm3'),
      gramsPerHour: text(form, 'gramsPerHour'),
      stockGrams: text(form, 'stockGrams'),
      lowStockThresholdGrams: text(form, 'lowStockThresholdGrams'),
      active: checked(form, 'active'),
    },
    (dto) =>
      id
        ? api.put(`/materials/${encodeURIComponent(id)}`, dto)
        : api.post('/materials', dto),
  );
}

export default function Materials({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <AdminHeader
        title="Materials"
        intro="Filament and resin: what a gram costs you, and how dense and fast it prints — used to price products and to estimate grams and hours from a 3D model."
      />
      <div className="grid gap-4">
        {loaderData.materials.map((m) => (
          <MaterialForm key={m.id} material={m} />
        ))}
        <MaterialForm key="new" />
      </div>
    </>
  );
}

function MaterialForm({ material }: { material?: MaterialView }) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  const low =
    material && material.stockGrams <= material.lowStockThresholdGrams;
  return (
    <Panel
      title={material ? `${material.name} (${material.code})` : 'New material'}
    >
      {low && (
        <p className="text-sm font-semibold text-warning">
          Low stock: {material.stockGrams} g left
        </p>
      )}
      <fetcher.Form
        method="post"
        key={!material && fetcher.data?.ok ? 'reset' : 'form'}
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {material && <input type="hidden" name="id" value={material.id} />}
        <Field
          label="Code"
          name="code"
          required
          defaultValue={material?.code}
          error={errors['code']}
          hint="e.g. PLA, PETG-CF"
        />
        <Field
          label="Name"
          name="name"
          required
          defaultValue={material?.name}
          error={errors['name']}
        />
        <Field
          label="Cost per gram (USD)"
          name="pricePerGram"
          inputMode="decimal"
          required
          defaultValue={material?.pricePerGram}
          error={errors['pricePerGram']}
          hint="Spool price ÷ grams, e.g. 0.035"
        />
        <Field
          label="Density (g/cm³)"
          name="densityGPerCm3"
          inputMode="decimal"
          defaultValue={material?.densityGPerCm3 ?? '1.24'}
          error={errors['densityGPerCm3']}
          hint="PLA 1.24 · PETG 1.27 · ASA 1.07"
        />
        <Field
          label="Prints per hour (g)"
          name="gramsPerHour"
          inputMode="decimal"
          defaultValue={material?.gramsPerHour ?? '12'}
          error={errors['gramsPerHour']}
          hint="Your printers' average"
        />
        <Field
          label="In stock (g)"
          name="stockGrams"
          type="number"
          min={0}
          defaultValue={material?.stockGrams ?? 0}
          error={errors['stockGrams']}
        />
        <Field
          label="Warn below (g)"
          name="lowStockThresholdGrams"
          type="number"
          min={0}
          defaultValue={material?.lowStockThresholdGrams ?? 1000}
          error={errors['lowStockThresholdGrams']}
        />
        <CheckboxField
          label="In use"
          name="active"
          defaultChecked={material?.active ?? true}
        />
        <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
          <Button type="submit" disabled={fetcher.state !== 'idle'}>
            {material ? 'Save' : 'Add material'}
          </Button>
          <SaveStatus state={fetcher.state} result={fetcher.data} />
        </div>
      </fetcher.Form>
    </Panel>
  );
}
