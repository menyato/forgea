import type { StockItemView } from '@forgea/types';
import { StockSweepDto } from '@forgea/validation';
import { useState } from 'react';
import { Link, useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { stockOverview } from '~/features/stock/stock.server';
import {
  filament,
  grams,
  RecordPage,
  SignedGrams,
  Swatch,
} from '~/features/stock/stock-ui';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ context }: Route.LoaderArgs) {
  const stock = await stockOverview(context.get(apiContext));
  // Tracked filaments first, then by material and name.
  const items = [...stock.items].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      a.material.code.localeCompare(b.material.code) ||
      a.colour.localeCompare(b.colour),
  );
  return { items };
}

/** Each weighed line posts `shelf:<stock line id>` = grams on the shelf. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const lines = [...form.keys()]
    .filter((k) => k.startsWith('shelf:'))
    .map((k) => ({
      stockItemId: k.slice('shelf:'.length),
      gramsOnShelf: text(form, k),
    }));
  return save(StockSweepDto, { lines, note: text(form, 'note') }, (dto) =>
    context.get(apiContext).post('/stock/sweeps', dto),
  );
}

/** What one filament's shelf holds: its sealed spools, plus the open one less its empty spool. */
interface Weighed {
  sealed: string;
  scale: string;
}

function onShelf(
  w: Weighed | undefined,
  spoolGrams: number,
  emptySpool: number,
): number | null {
  if (!w || (w.sealed === '' && w.scale === '')) return null;
  const sealed = Number(w.sealed || 0) * spoolGrams;
  const open = w.scale === '' ? 0 : Math.max(0, Number(w.scale) - emptySpool);
  return Math.round(sealed + open);
}

export default function StockSweep({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData;
  const fetcher = useFetcher<SaveResult>();
  const [emptySpool, setEmptySpool] = useState('');
  const [weighed, setWeighed] = useState<Record<string, Weighed>>({});
  const empty = Number(emptySpool || 0);
  const set = (id: string, part: keyof Weighed, value: string) =>
    setWeighed((w) => ({
      ...w,
      [id]: { sealed: '', scale: '', ...w[id], [part]: value },
    }));
  const counted = items.flatMap((i) => {
    const g = onShelf(weighed[i.id], i.spoolGrams, empty);
    return g === null ? [] : [{ grams: g, change: g - i.stockGrams }];
  });
  const off = counted.filter((c) => c.change !== 0);
  const done = fetcher.state === 'idle' && fetcher.data?.ok === true;
  return (
    <RecordPage
      title="Weigh every filament"
      intro="Go along the shelf once: for each filament, count the sealed spools and weigh the open one. Whatever differs from what the shelf should hold is recorded as a correction, all at once."
      line={null}
    >
      <fetcher.Form
        method="post"
        key={done ? 'saved' : 'form'}
        className="grid gap-6"
      >
        <Panel title="Before you start">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="An empty spool weighs (g)"
              name="emptySpool"
              type="number"
              min={0}
              value={emptySpool}
              onChange={(e) => setEmptySpool(e.currentTarget.value)}
              hint="Taken off each open spool. Weigh an empty one of the brand you use."
            />
            <Field
              label="Note (optional)"
              name="note"
              placeholder="e.g. end-of-month sweep"
            />
          </div>
        </Panel>
        <Panel title="The shelf">
          <div className="overflow-x-auto">
            <table aria-label="Filaments to weigh" className="w-full text-sm">
              <thead className="text-left text-text-muted">
                <tr>
                  <th className="py-2 pr-4 font-medium">Filament</th>
                  <th className="py-2 pr-4 text-right font-medium">
                    Should hold
                  </th>
                  <th className="py-2 pr-4 font-medium">Sealed spools</th>
                  <th className="py-2 pr-4 font-medium">
                    Open spool on the scale (g)
                  </th>
                  <th className="py-2 text-right font-medium">On the shelf</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <SweepRow
                    key={i.id}
                    item={i}
                    weighed={weighed[i.id]}
                    total={onShelf(weighed[i.id], i.spoolGrams, empty)}
                    onChange={(part, value) => set(i.id, part, value)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">
            {counted.length === 0
              ? 'Nothing weighed yet.'
              : off.length === 0
                ? `${counted.length} weighed, all as they should be: nothing to record.`
                : `${counted.length} weighed; ${off.length} differ and will be corrected.`}
          </p>
          <Button
            type="submit"
            disabled={counted.length === 0 || fetcher.state !== 'idle'}
          >
            Save the sweep
          </Button>
          <SaveStatus state={fetcher.state} result={fetcher.data} />
          {done && (
            <Link
              to="/admin/stock/movements?filter=CORRECTION"
              className="text-sm underline"
            >
              See the corrections
            </Link>
          )}
        </div>
      </fetcher.Form>
    </RecordPage>
  );
}

function SweepRow({
  item: i,
  weighed,
  total,
  onChange,
}: {
  item: StockItemView;
  weighed: Weighed | undefined;
  total: number | null;
  onChange: (part: keyof Weighed, value: string) => void;
}) {
  const name = filament(i);
  const input = 'rounded-md border border-border bg-surface px-2 py-1';
  return (
    <tr className="border-t border-border">
      <td className="py-2 pr-4">
        <span className="inline-flex items-center gap-2">
          <Swatch hex={i.swatchHex} />
          <Link
            to={`/admin/stock/${i.id}`}
            className="underline underline-offset-2"
          >
            {name}
          </Link>
          {!i.active && (
            <span className="text-xs text-text-muted">not tracked</span>
          )}
        </span>
      </td>
      <td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums">
        {grams(i.stockGrams)}
      </td>
      <td className="py-2 pr-4">
        <input
          type="number"
          min={0}
          step={1}
          name={`sealed:${i.id}`}
          autoComplete="off"
          aria-label={`${name}: sealed spools (${i.spoolGrams} g each)`}
          value={weighed?.sealed ?? ''}
          onChange={(e) => onChange('sealed', e.currentTarget.value)}
          className={`w-20 ${input}`}
        />
      </td>
      <td className="py-2 pr-4">
        <input
          type="number"
          min={0}
          step={1}
          name={`scale:${i.id}`}
          autoComplete="off"
          aria-label={`${name}: open spool on the scale (g)`}
          value={weighed?.scale ?? ''}
          onChange={(e) => onChange('scale', e.currentTarget.value)}
          className={`w-28 ${input}`}
        />
      </td>
      <td className="py-2 text-right whitespace-nowrap tabular-nums">
        {total === null ? (
          '—'
        ) : (
          <>
            <input type="hidden" name={`shelf:${i.id}`} value={total} />
            {grams(total)}{' '}
            {total !== i.stockGrams && (
              <span className="text-xs">
                (<SignedGrams value={total - i.stockGrams} />)
              </span>
            )}
          </>
        )}
      </td>
    </tr>
  );
}
