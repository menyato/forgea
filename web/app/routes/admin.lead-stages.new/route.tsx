import type { LeadStageView } from '@forgea/types';
import { SaveLeadStageDto } from '@forgea/validation';
import { redirect } from 'react-router';
import { AdminHeader } from '~/features/admin/admin-ui';
import { saveNew } from '~/features/admin/staff.server';
import { StageForm } from '~/features/pipeline/pipeline-forms';
import { stageValues } from '~/features/pipeline/pipeline-values.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** A new stage; opens its page. */
export async function action({ request, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  // The API answers with every one: the new one is the one not there before.
  const before = await api.get<LeadStageView[]>('/lead-stages');
  const known = before.ok ? new Set(before.data.map((x) => x.id)) : null;
  return saveNew(
    SaveLeadStageDto,
    stageValues(form),
    (dto) => api.post<LeadStageView[]>('/lead-stages', dto),
    (all) => {
      const id = known && all.find((x) => !known.has(x.id))?.id;
      return id ? `/admin/lead-stages/${id}` : null;
    },
  );
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
