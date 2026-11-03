import type { LostReasonView } from '@forgea/types';
import { SaveLostReasonDto } from '@forgea/validation';
import { redirect } from 'react-router';
import { AdminHeader } from '~/features/admin/admin-ui';
import { save } from '~/features/admin/staff.server';
import { ReasonForm } from '~/features/pipeline/pipeline-forms';
import { reasonValues } from '~/features/pipeline/pipeline-values.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** A new lost reason; opens its page. */
export async function action({ request, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  let createdId: string | undefined;
  const result = await save(
    SaveLostReasonDto,
    reasonValues(form),
    async (dto) => {
      // The API answers with every reason: the new one is the one not there before.
      const before = await api.get<LostReasonView[]>('/lost-reasons');
      const known = new Set(before.ok ? before.data.map((x) => x.id) : []);
      const r = await api.post<LostReasonView[]>('/lost-reasons', dto);
      if (r.ok && before.ok)
        createdId = r.data.find((x) => !known.has(x.id))?.id;
      return r;
    },
  );
  if (createdId) throw redirect(`/admin/lost-reasons/${createdId}`);
  return result;
}

export default function NewLostReason() {
  return (
    <>
      <AdminHeader
        title="New lost reason"
        intro="Offered to the team when they close a lead without a sale."
        trail={[{ label: 'Lost reasons', to: '/admin/lost-reasons' }]}
      />
      <ReasonForm reason={null} />
    </>
  );
}
