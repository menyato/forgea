import type { LostReasonView } from '@forgea/types';
import { SaveLostReasonDto } from '@forgea/validation';
import { AdminHeader } from '~/features/admin/admin-ui';
import { save } from '~/features/admin/staff.server';
import { ReasonForm } from '~/features/pipeline/pipeline-forms';
import { reasonValues } from '~/features/pipeline/pipeline-values.server';
import { apiContext } from '~/lib/request.server';
import { DeleteRecord } from '~/features/admin/delete-record';
import { oneOf } from '~/features/admin/related.server';
import type { Route } from './+types/route';

export async function loader({ params, context }: Route.LoaderArgs) {
  return {
    reason: await oneOf<LostReasonView>(
      context.get(apiContext),
      '/lost-reasons',
      params.id,
      'lost reason',
    ),
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const form = await request.formData();
  return save(SaveLostReasonDto, reasonValues(form), (dto) =>
    context
      .get(apiContext)
      .put(`/lost-reasons/${encodeURIComponent(params.id)}`, dto),
  );
}

export default function LostReason({ loaderData }: Route.ComponentProps) {
  const { reason } = loaderData;
  return (
    <>
      <AdminHeader
        title={reason.name}
        intro="Offered to the team when they close a lead without a sale."
        trail={[{ label: 'Lost reasons', to: '/admin/lost-reasons' }]}
      />
      <ReasonForm key={reason.id} reason={reason} />
      <div className="mt-8 border-t border-border pt-4">
        <DeleteRecord kind="lostReason" id={reason.id} what={'this reason'} />
      </div>
    </>
  );
}
