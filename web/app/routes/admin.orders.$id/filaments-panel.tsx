import type { OrderFilaments } from '@forgea/types';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { SelectField } from '~/components/ui/field';
import { Panel, SaveStatus } from '~/features/admin/admin-ui';
import type { SaveResult } from '~/features/admin/staff.server';
import type { Choice } from '~/features/production/choices.server';

/**
 * The order's lines made from a 3MF: each colour of the file and the reel from the shelf it
 * prints from. Every colour needs one before the order can go into production; the reel's
 * filament must be the one the file was sliced for (PLA, PETG…). Changed after production
 * started, what the line took moves to the new reels.
 */
export function FilamentsPanel({
  filaments,
  reels,
}: {
  filaments: OrderFilaments;
  reels: readonly Choice[];
}) {
  const fetcher = useFetcher<SaveResult>();
  return (
    <Panel title="Filaments">
      <p className="text-sm text-text-muted">
        {filaments.complete
          ? 'Each colour of the print file has its reel: stock is taken from these.'
          : 'Pick the reel each colour of the print file prints from. The order goes into production only once every colour has one.'}
      </p>
      <fetcher.Form method="post" className="grid gap-4">
        <input type="hidden" name="intent" value="filaments" />
        {filaments.lines.map((line) => (
          <fieldset key={line.orderItemId} className="grid min-w-0 gap-3">
            <legend className="mb-1 text-sm font-medium">
              {line.quantity} × {line.name}
            </legend>
            {line.colours.map((c) => (
              <div
                key={c.colour}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-3"
              >
                <span
                  aria-hidden
                  className="mb-2.5 size-5 rounded-full border border-border"
                  style={{ background: c.hex }}
                />
                <SelectField
                  label={`${c.colour} · ${c.grams} g${c.type ? ` · sliced for ${c.type}` : ''}`}
                  name={`reel:${line.orderItemId}:${c.colour}`}
                  defaultValue={c.stockItemId ?? c.suggestedId ?? ''}
                  disabled={!filaments.editable}
                >
                  <option value="">Choose the reel…</option>
                  {reels.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </SelectField>
              </div>
            ))}
          </fieldset>
        ))}
        {filaments.editable && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              variant={filaments.complete ? 'secondary' : 'primary'}
              disabled={fetcher.state !== 'idle'}
            >
              Save the reels
            </Button>
            <SaveStatus state={fetcher.state} result={fetcher.data} />
          </div>
        )}
      </fetcher.Form>
    </Panel>
  );
}
