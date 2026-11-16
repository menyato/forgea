import type { MaterialView } from '@forgea/types';
import { SaveMaterialDto } from '@forgea/validation';
import { useCan } from '~/features/admin/access';
import { AdminHeader, ViewOnly } from '~/features/admin/admin-ui';
import { save } from '~/features/admin/staff.server';
import { MaterialForm } from '~/features/admin-materials/material-form';
import { materialValues } from '~/features/admin-materials/material-values.server';
import { apiContext } from '~/lib/request.server';
import { DeleteRecord } from '~/features/admin/delete-record';
import { oneOf } from '~/features/admin/related.server';
import type { Route } from './+types/route';

export async function loader({ params, context }: Route.LoaderArgs) {
  return {
    material: await oneOf<MaterialView>(
      context.get(apiContext),
      '/materials',
      params.id,
      'material',
    ),
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const form = await request.formData();
  return save(SaveMaterialDto, materialValues(form), (dto) =>
    context
      .get(apiContext)
      .put(`/materials/${encodeURIComponent(params.id)}`, dto),
  );
}

export default function EditMaterial({ loaderData }: Route.ComponentProps) {
  const { material } = loaderData;
  const editable = useCan()('materials.manage');
  return (
    <>
      <AdminHeader
        trail={[{ label: 'Materials', to: '/admin/materials' }]}
        title={material.name}
        intro={`${material.code}: what a gram costs, how it prints and how much is on the shelf.`}
      />
      <ViewOnly editable={editable}>
        <MaterialForm key={material.id} material={material} />
      </ViewOnly>
      <div className="mt-8 border-t border-border pt-4">
        <DeleteRecord kind="material" id={material.id} what={'this material'} />
      </div>
    </>
  );
}
