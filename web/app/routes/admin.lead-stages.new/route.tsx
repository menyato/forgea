import type { LeadStageView } from '@forgea/types';
import { SaveLeadStageDto } from '@forgea/validation';
import { redirect } from 'react-router';
import { AdminHeader } from '~/features/admin/admin-ui';
import { save } from '~/features/admin/staff.server';
import { StageForm } from '~/features/pipeline/pipeline-forms';
import { stageValues } from '~/features/pipeline/pipeline-values.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** A new stage; opens its page. */
export async function action({ request, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  let createdId: string | undefined;
  const result = await save(
    SaveLeadStageDto,
    stageValues(form),
    async (dto) => {
      // The API answers with every stage: the new one is the one not there before.
      const before = await api.get<LeadStageView[]>('/lead-stages');
      const known = new Set(before.ok ? before.data.map((s) => s.id) : []);
      const r = await api.post<LeadStageView[]>('/lead-stages', dto);
      if (r.ok && before.ok)
        createdId = r.data.find((s) => !known.has(s.id))?.id;
      return r;
    },
  );
  if (createdId) throw redirect(`/admin/lead-stages/${createdId}`);
  return result;
}

export default function NewLeadStage() {
  return (
    <>
      <AdminHeader
        title="New stage"
        intro="A step leads go through. Its order places it on the pipeline."
        trail={[{ label: 'Lead stages', to: '/admin/lead-stages' }]}
      />
      <StageForm stage={null} />
    </>
  );
}
