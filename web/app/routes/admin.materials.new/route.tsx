import type { MaterialView } from '@forgea/types';
import { SaveMaterialDto } from '@forgea/validation';
import { redirect } from 'react-router';
import { AdminHeader } from '~/features/admin/admin-ui';
import { save } from '~/features/admin/staff.server';
import { MaterialForm } from '~/features/admin-materials/material-form';
import { materialValues } from '~/features/admin-materials/material-values.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** A new material; opens its page. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  let createdId: string | undefined;
  const result = await save(
    SaveMaterialDto,
    materialValues(form),
    async (dto) => {
      const r = await context
        .get(apiContext)
        .post<MaterialView>('/materials', dto);
      if (r.ok) createdId = r.data.id;
      return r;
    },
  );
  if (createdId) throw redirect(`/admin/materials/${createdId}`);
  return result;
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
