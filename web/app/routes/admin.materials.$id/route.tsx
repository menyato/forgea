import type { MaterialView } from '@forgea/types';
import { SaveMaterialDto } from '@forgea/validation';
import { useCan } from '~/features/admin/access';
import { AdminHeader, ViewOnly } from '~/features/admin/admin-ui';
import { save } from '~/features/admin/staff.server';
import { MaterialForm } from '~/features/admin-materials/material-form';
import { materialValues } from '~/features/admin-materials/material-values.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ params, context }: Route.LoaderArgs) {
  // The API sends materials as one list.
  const r = await context.get(apiContext).get<MaterialView[]>('/materials');
  if (!r.ok) throw new Response(r.message, { status: r.status });
  const material = r.data.find((m) => m.id === params.id);
  if (!material) throw new Response('No such material', { status: 404 });
  return { material };
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
    </>
  );
}
