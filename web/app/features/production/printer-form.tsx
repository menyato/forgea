import type { PrinterView } from '@forgea/types';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { CheckboxField, Field, TextAreaField } from '~/components/ui/field';
import { Panel, SaveStatus } from '~/features/admin/admin-ui';
import type { SaveResult } from '~/features/admin/staff.server';

/** A printer's details: its power gives each job's electricity, its price over its life the wear. */
export function PrinterForm({ printer }: { printer: PrinterView | null }) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <fetcher.Form method="post" className="grid max-w-2xl gap-6">
      <Panel title="The printer">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Name"
            name="name"
            required
            defaultValue={printer?.name}
            error={errors['name']}
          />
          <Field
            label="Power while printing (watts)"
            name="watts"
            type="number"
            min={1}
            required
            defaultValue={printer?.watts ?? 150}
            hint="Each job's electricity is its hours × this."
            error={errors['watts']}
          />
          <Field
            label="What it cost (USD, optional)"
            name="priceUsd"
            inputMode="decimal"
            defaultValue={printer?.priceUsd ?? undefined}
            error={errors['priceUsd']}
          />
          <Field
            label="Print hours it should last (optional)"
            name="lifeHours"
            type="number"
            min={1}
            defaultValue={printer?.lifeHours ?? undefined}
            hint="With its price: the wear each print hour costs."
            error={errors['lifeHours']}
          />
        </div>
        <TextAreaField
          label="Notes (optional)"
          name="notes"
          rows={2}
          defaultValue={printer?.notes ?? undefined}
        />
        <CheckboxField
          label="In use"
          name="active"
          hint="Printers not in use can't be chosen for new jobs; their jobs keep them."
          defaultChecked={printer?.active ?? true}
        />
      </Panel>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={fetcher.state !== 'idle'}>
          {printer ? 'Save' : 'Add the printer'}
        </Button>
        <SaveStatus state={fetcher.state} result={fetcher.data} />
      </div>
    </fetcher.Form>
  );
}
