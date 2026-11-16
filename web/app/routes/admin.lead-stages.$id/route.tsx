import type { LeadStageView } from '@forgea/types';
import { SaveLeadStageDto } from '@forgea/validation';
import { AdminHeader } from '~/features/admin/admin-ui';
import { save } from '~/features/admin/staff.server';
import { StageForm } from '~/features/pipeline/pipeline-forms';
import { stageValues } from '~/features/pipeline/pipeline-values.server';
import { apiContext } from '~/lib/request.server';
import { DeleteRecord } from '~/features/admin/delete-record';
import { oneOf } from '~/features/admin/related.server';
import type { Route } from './+types/route';

export async function loader({ params, context }: Route.LoaderArgs) {
  return {
    stage: await oneOf<LeadStageView>(
      context.get(apiContext),
      '/lead-stages',
      params.id,
      'stage',
    ),
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const form = await request.formData();
  return save(SaveLeadStageDto, stageValues(form), (dto) =>
    context
      .get(apiContext)
      .put(`/lead-stages/${encodeURIComponent(params.id)}`, dto),
  );
}

export default function LeadStage({ loaderData }: Route.ComponentProps) {
  const { stage } = loaderData;
  return (
    <>
      <AdminHeader
        title={stage.name}
        intro="A step leads go through. Its order places it on the pipeline; moving a lead into a won stage wins it."
        trail={[{ label: 'Lead stages', to: '/admin/lead-stages' }]}
      />
      {/* A new stage, a new form (the pager moves between stages). */}
      <StageForm key={stage.id} stage={stage} />
      <div className="mt-8 border-t border-border pt-4">
        <DeleteRecord kind="leadStage" id={stage.id} what={'this stage'} />
      </div>
    </>
  );
}
