import type { OptionGroupView } from '@forgea/types';
import { SaveOptionGroupDto } from '@forgea/validation';
import { redirect } from 'react-router';
import { AdminHeader } from '~/features/admin/admin-ui';
import { save } from '~/features/admin/staff.server';
import { GroupForm } from '~/features/admin-options/group-form';
import { groupValues } from '~/features/admin-options/group-values.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** A new option; opens its page, where its choices go in. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  let createdId: string | undefined;
  const result = await save(
    SaveOptionGroupDto,
    groupValues(form),
    async (dto) => {
      const r = await context
        .get(apiContext)
        .post<OptionGroupView>('/option-groups', dto);
      if (r.ok) createdId = r.data.id;
      return r;
    },
  );
  if (createdId) throw redirect(`/admin/options/${createdId}`);
  return result;
}

export default function NewOption() {
  return (
    <>
      <AdminHeader
        title="New option"
        intro="Something customers choose on a product. A list's choices and their price rules go in once it is added."
        trail={[{ label: 'Options', to: '/admin/options' }]}
      />
      <GroupForm />
    </>
  );
}
