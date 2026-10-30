import {
  type MaterialView,
  OptionKind,
  type OptionGroupView,
  type OptionValueView,
} from '@forgea/types';
import { SaveOptionGroupDto, SaveOptionValueDto } from '@forgea/validation';
import { useState } from 'react';
import { data, useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { CheckboxField, Field, SelectField } from '~/components/ui/field';
import { useCan } from '~/features/admin/access';
import {
  AdminHeader,
  Panel,
  SaveStatus,
  ViewOnly,
} from '~/features/admin/admin-ui';
import {
  checked,
  type SaveResult,
  save,
  text,
} from '~/features/admin/staff.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const [groups, materials] = await Promise.all([
    api.get<OptionGroupView[]>('/option-groups'),
    api.get<MaterialView[]>('/materials'),
  ]);
  if (!groups.ok) throw new Response(groups.message, { status: groups.status });
  if (!materials.ok)
    throw new Response(materials.message, { status: materials.status });
  return { groups: groups.data, materials: materials.data };
}

export async function action({ request, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const intent = form.get('intent');
  const groupId = encodeURIComponent(text(form, 'groupId') ?? '');
  const valueId = text(form, 'valueId');
  const common = {
    sortOrder: text(form, 'sortOrder') ?? 0,
    active: checked(form, 'active'),
  };

  if (intent === 'group') {
    return save(
      SaveOptionGroupDto,
      {
        ...common,
        name: text(form, 'name'),
        kind: text(form, 'kind'),
        maxLength: text(form, 'maxLength'),
        textExtraPrice: text(form, 'textExtraPrice') ?? '0',
      },
      (dto) =>
        groupId
          ? api.put(`/option-groups/${groupId}`, dto)
          : api.post('/option-groups', dto),
    );
  }
  if (intent === 'value') {
    return save(
      SaveOptionValueDto,
      {
        ...common,
        label: text(form, 'label'),
        // The colour picker always sends a value: only keep it when the swatch is on.
        swatchHex: checked(form, 'hasSwatch')
          ? text(form, 'swatchHex')
          : undefined,
        gramsMultiplier: text(form, 'gramsMultiplier') ?? '1',
        hoursMultiplier: text(form, 'hoursMultiplier') ?? '1',
        extraPrice: text(form, 'extraPrice') ?? '0',
        materialId: text(form, 'materialId'),
      },
      (dto) =>
        valueId
          ? api.put(
              `/option-groups/${groupId}/values/${encodeURIComponent(valueId)}`,
              dto,
            )
          : api.post(`/option-groups/${groupId}/values`, dto),
    );
  }
  return data<SaveResult>({ error: 'Unknown action' }, { status: 400 });
}

export default function Options({ loaderData }: Route.ComponentProps) {
  const { groups, materials } = loaderData;
  const editable = useCan()('catalog.manage');
  return (
    <>
      <AdminHeader
        title="Options"
        intro="What customers can choose on a product — colour, size, material, a name to print — and what each choice does to the price. Products pick which of these they offer."
      />
      <ViewOnly editable={editable}>
        <div className="grid gap-6">
          {editable && <GroupForm key="new" />}
          {groups.map((g) => (
            <Panel key={g.id} title={g.name}>
              <GroupForm group={g} />
              {g.kind === OptionKind.CHOICE && (
                <div className="grid gap-3">
                  <h3 className="text-sm font-semibold">Choices</h3>
                  {g.values.map((v) => (
                    <ValueForm
                      key={v.id}
                      groupId={g.id}
                      value={v}
                      materials={materials}
                    />
                  ))}
                  {editable && (
                    <ValueForm key="new" groupId={g.id} materials={materials} />
                  )}
                </div>
              )}
            </Panel>
          ))}
        </div>
      </ViewOnly>
    </>
  );
}

function GroupForm({ group }: { group?: OptionGroupView }) {
  const fetcher = useFetcher<SaveResult>();
  const [kind, setKind] = useState<OptionKind>(
    group?.kind ?? OptionKind.CHOICE,
  );
  const errors = fetcher.data?.errors ?? {};
  const form = (
    <fetcher.Form
      method="post"
      className="grid gap-4 sm:grid-cols-3"
      key={!group && fetcher.data?.ok ? 'reset' : 'form'}
    >
      <input type="hidden" name="intent" value="group" />
      {group && <input type="hidden" name="groupId" value={group.id} />}
      <Field
        label="Name customers see"
        name="name"
        required
        defaultValue={group?.name}
        error={errors['name']}
        hint="e.g. Colour, Size, Name on the tag"
      />
      <SelectField
        label="Type"
        name="kind"
        value={kind}
        onChange={(e) => setKind(e.currentTarget.value as OptionKind)}
        // A group with choices can't turn into a text box.
        disabled={(group?.values.length ?? 0) > 0}
        hint={
          kind === OptionKind.TEXT
            ? 'Customers type a short text'
            : 'Customers pick one of the choices below'
        }
      >
        <option value={OptionKind.CHOICE}>Pick from a list</option>
        <option value={OptionKind.TEXT}>Type a text</option>
      </SelectField>
      {(group?.values.length ?? 0) > 0 && (
        <input type="hidden" name="kind" value={kind} />
      )}
      <Field
        label="Order"
        name="sortOrder"
        type="number"
        min={0}
        defaultValue={group?.sortOrder ?? 0}
        error={errors['sortOrder']}
      />
      {kind === OptionKind.TEXT && (
        <>
          <Field
            label="Longest text"
            name="maxLength"
            type="number"
            min={1}
            max={200}
            defaultValue={group?.maxLength ?? 12}
            error={errors['maxLength']}
            hint="Characters, e.g. 12 for a keychain"
          />
          <Field
            label="Extra price when filled in (USD)"
            name="textExtraPrice"
            inputMode="decimal"
            defaultValue={group?.textExtraPrice ?? '0'}
            error={errors['textExtraPrice']}
          />
        </>
      )}
      <CheckboxField
        label="Offered"
        name="active"
        defaultChecked={group?.active ?? true}
        hint="Turn off to hide it from every product at once"
      />
      <div className="flex items-center gap-3 sm:col-span-3">
        <Button type="submit" disabled={fetcher.state !== 'idle'}>
          {group ? 'Save option' : 'Add option'}
        </Button>
        <SaveStatus state={fetcher.state} result={fetcher.data} />
      </div>
    </fetcher.Form>
  );
  return group ? form : <Panel title="New option">{form}</Panel>;
}

function ValueForm({
  groupId,
  value,
  materials,
}: {
  groupId: string;
  value?: OptionValueView;
  materials: readonly MaterialView[];
}) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  const [swatch, setSwatch] = useState(
    value?.swatchHex !== null && value !== undefined,
  );
  return (
    <fetcher.Form
      method="post"
      key={!value && fetcher.data?.ok ? 'reset' : 'form'}
      className={`grid gap-3 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-4 ${
        value ? 'border-border' : 'border-dashed border-border'
      }`}
    >
      <input type="hidden" name="intent" value="value" />
      <input type="hidden" name="groupId" value={groupId} />
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
  );
}
