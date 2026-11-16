import type { MaterialView } from '@forgea/types';
import { SaveMaterialDto } from '@forgea/validation';
import { AdminHeader } from '~/features/admin/admin-ui';
import { saveNew } from '~/features/admin/staff.server';
import { MaterialForm } from '~/features/admin-materials/material-form';
import { materialValues } from '~/features/admin-materials/material-values.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** A new material; opens its page. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  return saveNew(
    SaveMaterialDto,
    materialValues(form),
    (dto) => context.get(apiContext).post<MaterialView>('/materials', dto),
    (created) => `/admin/materials/${created.id}`,
  );
}

export default function NewMaterial() {
  return (
    <>
      <AdminHeader
        title="New material"
        intro="Its code and name, what one reel costs and weighs, and how it prints."
        trail={[{ label: 'Materials', to: '/admin/materials' }]}
      />
      <MaterialForm />
    </>
  );
}
