import {
  type MaterialView,
  OptionKind,
  type OptionGroupView,
  type StockOverview,
} from '@forgea/types';
import { SaveOptionGroupDto, SaveOptionValueDto } from '@forgea/validation';
import { useCan } from '~/features/admin/access';
import { AdminHeader, Panel, ViewOnly } from '~/features/admin/admin-ui';
import { checked, save, text } from '~/features/admin/staff.server';
import { GroupForm, kindLabel } from '~/features/admin-options/group-form';
import { groupValues } from '~/features/admin-options/group-values.server';
import { apiContext } from '~/lib/request.server';
import { DeleteRecord } from '~/features/admin/delete-record';
import type { Route } from './+types/route';
import { ValueForm } from './value-form';

export async function loader({ params, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  // The API sends option groups as one list.
  const [groups, materials, stock] = await Promise.all([
    api.get<OptionGroupView[]>('/option-groups'),
    api.get<MaterialView[]>('/materials'),
    // The filaments a colour may be printed from (none for someone who can't see the stock).
    api.get<StockOverview>('/stock'),
  ]);
  if (!groups.ok) throw new Response(groups.message, { status: groups.status });
  if (!materials.ok)
    throw new Response(materials.message, { status: materials.status });
  const group = groups.data.find((g) => g.id === params.id);
  if (!group) throw new Response('No such option', { status: 404 });
  return {
    group,
    materials: materials.data,
    filaments: stock.ok
      ? stock.data.items
          .filter((i) => i.active && i.colour !== '')
          .map((i) => ({
            id: i.id,
            material: i.material.code,
            colour: i.colour,
          }))
      : [],
  };
}

/** group (the option itself) | value (one of its choices, new or existing) */
export async function action({ request, params, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const base = `/option-groups/${encodeURIComponent(params.id)}`;
  if (form.get('intent') === 'group') {
    return save(SaveOptionGroupDto, groupValues(form), (dto) =>
      api.put(base, dto),
    );
  }
  const valueId = text(form, 'valueId');
  return save(
    SaveOptionValueDto,
    {
      label: text(form, 'label'),
      // The colour picker always sends a value: only keep it when the swatch is on.
      swatchHex: checked(form, 'hasSwatch')
        ? text(form, 'swatchHex')
        : undefined,
      gramsMultiplier: text(form, 'gramsMultiplier') ?? '1',
      hoursMultiplier: text(form, 'hoursMultiplier') ?? '1',
      extraPrice: text(form, 'extraPrice') ?? '0',
      materialId: text(form, 'materialId'),
      stockItemId: text(form, 'stockItemId'),
      sortOrder: text(form, 'sortOrder') ?? 0,
      active: checked(form, 'active'),
    },
    (dto) =>
      valueId
        ? api.put(`${base}/values/${encodeURIComponent(valueId)}`, dto)
        : api.post(`${base}/values`, dto),
  );
}

export default function EditOption({ loaderData }: Route.ComponentProps) {
  const { group, materials, filaments } = loaderData;
  const editable = useCan()('catalog.manage');
  return (
    <>
      <AdminHeader
        trail={[{ label: 'Options', to: '/admin/options' }]}
        title={group.name}
        intro={
          group.kind === OptionKind.CHOICE
            ? `${kindLabel(group.kind)}: its choices and what each does to the price. Products pick which options they offer.`
            : `${kindLabel(group.kind)}: customers type a short text on the products that offer it.`
        }
      />
      <ViewOnly editable={editable}>
        <div className="grid grid-cols-1 gap-6">
          <GroupForm key={group.id} group={group} />
          {group.kind === OptionKind.CHOICE && (
            <Panel title="Choices">
              <p className="text-sm text-text-muted">
                Each choice can use more or less material and time, add to the
                price, or print in another material. Each saves on its own.
              </p>
              {group.values.length === 0 && (
                <p className="text-sm text-text-muted">No choices yet.</p>
              )}
              {group.values.map((v) => (
                <ValueForm
                  key={v.id}
                  value={v}
                  materials={materials}
                  filaments={filaments}
                />
              ))}
              {editable && (
                <ValueForm
                  key={`new-${group.id}`}
                  materials={materials}
                  filaments={filaments}
                />
              )}
            </Panel>
          )}
        </div>
      </ViewOnly>
      <div className="mt-8 border-t border-border pt-4">
        <DeleteRecord kind="optionGroup" id={group.id} what={'this option'} />
      </div>
    </>
  );
}
