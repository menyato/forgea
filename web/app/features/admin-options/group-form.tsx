import { OptionKind, type OptionGroupView } from '@forgea/types';
import { useState } from 'react';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { CheckboxField, Field, SelectField } from '~/components/ui/field';
import { Panel, SaveStatus } from '~/features/admin/admin-ui';
import type { SaveResult } from '~/features/admin/staff.server';

export const kindLabel = (kind: OptionKind) =>
  kind === OptionKind.TEXT ? 'Type a text' : 'Pick from a list';

/**
 * An option group's form (new or existing): its name and type, and for a text the longest one
 * and what filling it in adds. A group's choices are edited below it on its own page.
 */
export function GroupForm({ group }: { group?: OptionGroupView }) {
  const fetcher = useFetcher<SaveResult>();
  const [kind, setKind] = useState<OptionKind>(
    group?.kind ?? OptionKind.CHOICE,
  );
  const errors = fetcher.data?.errors ?? {};
  // A group with choices can't turn into a text box.
  const kindLocked = (group?.values.length ?? 0) > 0;
  return (
    <fetcher.Form method="post" className="grid grid-cols-1 gap-4">
      <input type="hidden" name="intent" value="group" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Option">
          <Field
            label="Name customers see"
            name="name"
            required
            defaultValue={group?.name}
            error={errors['name']}
            hint="e.g. Colour, Size, Name on the tag"
          />
          <SelectField
            label="Type"
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.currentTarget.value as OptionKind)}
            disabled={kindLocked}
            hint={
              kind === OptionKind.TEXT
                ? 'Customers type a short text'
                : 'Customers pick one of its choices'
            }
          >
            <option value={OptionKind.CHOICE}>
              {kindLabel(OptionKind.CHOICE)}
            </option>
            <option value={OptionKind.TEXT}>
              {kindLabel(OptionKind.TEXT)}
            </option>
          </SelectField>
          {kindLocked && <input type="hidden" name="kind" value={kind} />}
        </Panel>
        <Panel title="In the shop">
          <Field
            label="Order"
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={group?.sortOrder ?? 0}
            error={errors['sortOrder']}
          />
          <CheckboxField
            label="Offered"
            name="active"
            defaultChecked={group?.active ?? true}
            hint="Turn off to hide it from every product at once"
          />
        </Panel>
        {kind === OptionKind.TEXT && (
          <Panel title="Text">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Longest text"
                name="maxLength"
                type="number"
                min={1}
                max={200}
                defaultValue={group?.maxLength ?? 12}
                error={errors['maxLength']}
                hint="Characters, e.g. 12 for a keychain"
              />
              <Field
                label="Extra price when filled in (USD)"
                name="textExtraPrice"
                inputMode="decimal"
                defaultValue={group?.textExtraPrice ?? '0'}
                error={errors['textExtraPrice']}
              />
            </div>
          </Panel>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={fetcher.state !== 'idle'}>
          {group ? 'Save option' : 'Add option'}
        </Button>
        <SaveStatus state={fetcher.state} result={fetcher.data} />
      </div>
    </fetcher.Form>
  );
}
