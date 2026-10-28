import type { LeadStageView, LostReasonView } from '@forgea/types';
import { SaveLeadStageDto, SaveLostReasonDto } from '@forgea/validation';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { CheckboxField, Field } from '~/components/ui/field';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import {
  checked,
  type SaveResult,
  save,
  text,
} from '~/features/admin/staff.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const [stages, reasons] = await Promise.all([
    api.get<LeadStageView[]>('/lead-stages'),
    api.get<LostReasonView[]>('/lost-reasons'),
  ]);
  if (!stages.ok) throw new Response(stages.message, { status: stages.status });
  return { stages: stages.data, reasons: reasons.ok ? reasons.data : [] };
}

export async function action({ request, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const id = text(form, 'id');
  if (form.get('intent') === 'reason') {
    return save(
      SaveLostReasonDto,
      { name: text(form, 'name'), active: checked(form, 'active') },
      (dto) =>
        id
          ? api.put(`/lost-reasons/${encodeURIComponent(id)}`, dto)
          : api.post('/lost-reasons', dto),
    );
  }
  return save(
    SaveLeadStageDto,
    {
      name: text(form, 'name'),
      sortOrder: text(form, 'sortOrder'),
      isWon: checked(form, 'isWon'),
      defaultProbability: text(form, 'defaultProbability'),
      active: checked(form, 'active'),
    },
    (dto) =>
      id
        ? api.put(`/lead-stages/${encodeURIComponent(id)}`, dto)
        : api.post('/lead-stages', dto),
  );
}

export default function Pipeline({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <AdminHeader
        title="Pipeline"
        intro="The stages a lead goes through, in order, and the reasons you lose some. Moving a lead into the stage marked won wins it."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Stages">
          {[...loaderData.stages, null].map((s) => (
            <StageForm key={s?.id ?? 'new'} stage={s} />
          ))}
        </Panel>
        <Panel title="Lost reasons">
          {[...loaderData.reasons, null].map((r) => (
            <ReasonForm key={r?.id ?? 'new'} reason={r} />
          ))}
        </Panel>
      </div>
    </>
  );
}

function StageForm({ stage }: { stage: LeadStageView | null }) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <fetcher.Form
      method="post"
      key={!stage && fetcher.data?.ok ? 'reset' : 'form'}
      className="grid grid-cols-[1fr_5rem_6rem] items-end gap-2 border-b border-border pb-3"
    >
      {stage && <input type="hidden" name="id" value={stage.id} />}
      <Field
        label={stage ? 'Stage' : 'New stage'}
        name="name"
        defaultValue={stage?.name}
        required
        error={errors['name']}
      />
      <Field
        label="Order"
        name="sortOrder"
        type="number"
        min={0}
        defaultValue={stage?.sortOrder ?? 10}
      />
      <Field
        label="Chance (%)"
        name="defaultProbability"
        type="number"
        min={0}
        max={100}
        defaultValue={stage?.defaultProbability ?? 20}
      />
      <div className="col-span-3 flex flex-wrap items-center gap-4">
        <CheckboxField
          label="Won stage"
          name="isWon"
          defaultChecked={stage?.isWon ?? false}
        />
        <CheckboxField
          label="In use"
          name="active"
          defaultChecked={stage?.active ?? true}
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={fetcher.state !== 'idle'}
        >
          {stage ? 'Save' : 'Add'}
        </Button>
        <SaveStatus state={fetcher.state} result={fetcher.data} />
      </div>
    </fetcher.Form>
  );
}

function ReasonForm({ reason }: { reason: LostReasonView | null }) {
  const fetcher = useFetcher<SaveResult>();
  return (
    <fetcher.Form
      method="post"
      key={!reason && fetcher.data?.ok ? 'reset' : 'form'}
      className="flex flex-wrap items-end gap-3 border-b border-border pb-3"
    >
      <input type="hidden" name="intent" value="reason" />
      {reason && <input type="hidden" name="id" value={reason.id} />}
      <Field
        label={reason ? 'Reason' : 'New reason'}
        name="name"
        defaultValue={reason?.name}
        required
        error={fetcher.data?.errors?.['name']}
      />
      <CheckboxField
        label="In use"
        name="active"
        defaultChecked={reason?.active ?? true}
      />
      <Button
        type="submit"
        variant="secondary"
        disabled={fetcher.state !== 'idle'}
      >
        {reason ? 'Save' : 'Add'}
      </Button>
      <SaveStatus state={fetcher.state} result={fetcher.data} />
    </fetcher.Form>
  );
}
