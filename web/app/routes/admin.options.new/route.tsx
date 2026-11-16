import type { OptionGroupView } from '@forgea/types';
import { SaveOptionGroupDto } from '@forgea/validation';
import { AdminHeader } from '~/features/admin/admin-ui';
import { saveNew } from '~/features/admin/staff.server';
import { GroupForm } from '~/features/admin-options/group-form';
import { groupValues } from '~/features/admin-options/group-values.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** A new option; opens its page, where its choices go in. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  return saveNew(
    SaveOptionGroupDto,
    groupValues(form),
    (dto) =>
      context.get(apiContext).post<OptionGroupView>('/option-groups', dto),
    (created) => `/admin/options/${created.id}`,
  );
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
