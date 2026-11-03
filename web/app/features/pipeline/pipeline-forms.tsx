import type { LeadStageView, LostReasonView } from '@forgea/types';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { CheckboxField, Field } from '~/components/ui/field';
import { useCan } from '~/features/admin/access';
import { Panel, SaveStatus, ViewOnly } from '~/features/admin/admin-ui';
import type { SaveResult } from '~/features/admin/staff.server';

/** A lead stage's form: the same fields to add one and to change one. */
export function StageForm({ stage }: { stage: LeadStageView | null }) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <ViewOnly editable={useCan()('pipeline.manage')}>
      <fetcher.Form method="post" className="grid gap-6">
        <Panel title="Stage">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Name"
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
              max={1000}
              hint="Lower comes first on the pipeline."
              defaultValue={stage?.sortOrder ?? 10}
              error={errors['sortOrder']}
            />
            <Field
              label="Chance of winning (%)"
              name="defaultProbability"
              type="number"
              min={0}
              max={100}
              defaultValue={stage?.defaultProbability ?? 20}
              error={errors['defaultProbability']}
            />
          </div>
          <CheckboxField
            label="Won stage"
            name="isWon"
            hint="Moving a lead into this stage wins it."
            defaultChecked={stage?.isWon ?? false}
          />
          <CheckboxField
            label="In use"
            name="active"
            hint="Stages not in use leave the pipeline; their leads keep them."
            defaultChecked={stage?.active ?? true}
          />
        </Panel>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={fetcher.state !== 'idle'}>
            {stage ? 'Save' : 'Add the stage'}
          </Button>
          <SaveStatus state={fetcher.state} result={fetcher.data} />
        </div>
      </fetcher.Form>
    </ViewOnly>
  );
}

/** A lost reason's form, to add one and to change one. */
export function ReasonForm({ reason }: { reason: LostReasonView | null }) {
  const fetcher = useFetcher<SaveResult>();
  return (
    <ViewOnly editable={useCan()('pipeline.manage')}>
      <fetcher.Form method="post" className="grid gap-6">
        <Panel title="Lost reason">
          <Field
            label="Reason"
            name="name"
            defaultValue={reason?.name}
            required
            error={fetcher.data?.errors?.['name']}
          />
          <CheckboxField
            label="In use"
            name="active"
            hint="Reasons not in use are no longer offered when a lead is lost."
            defaultChecked={reason?.active ?? true}
          />
        </Panel>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={fetcher.state !== 'idle'}>
            {reason ? 'Save' : 'Add the reason'}
          </Button>
          <SaveStatus state={fetcher.state} result={fetcher.data} />
        </div>
      </fetcher.Form>
    </ViewOnly>
  );
}
