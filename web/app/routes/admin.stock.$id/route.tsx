import {
  type Page,
  STOCK_MOVEMENT_LABELS,
  type StockItemView,
  type StockMovementView,
} from '@forgea/types';
import { SaveStockItemDto } from '@forgea/validation';
import type { ReactNode } from 'react';
import { Link, useFetcher } from 'react-router';
import { Money } from '~/components/money';
import { Button, buttonClass } from '~/components/ui/button';
import { CheckboxField, Field } from '~/components/ui/field';
import { useCan } from '~/features/admin/access';
import {
  AdminHeader,
  Panel,
  SaveStatus,
  ViewOnly,
} from '~/features/admin/admin-ui';
import {
  checked,
  type SaveResult,
  save,
  text,
} from '~/features/admin/staff.server';
import { stockOverview } from '~/features/stock/stock.server';
import {
  filament,
  grams,
  lineFilter,
  movementFor,
  ColourLook,
  SignedGrams,
  STOCK_ACTIONS,
  STOCK_TIME,
  StockBadge,
  StockMeter,
  Swatch,
} from '~/features/stock/stock-ui';
import { apiContext } from '~/lib/request.server';
import { DeleteRecord } from '~/features/admin/delete-record';
import type { Route } from './+types/route';

/** The line's latest movements shown here; the rest are on the movements list. */
const LATEST = 20;

export async function loader({ params, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const [stock, moves] = await Promise.all([
    stockOverview(api),
    api.get<Page<StockMovementView>>(
      `/stock/movements?stockItemId=${encodeURIComponent(params.id)}&limit=${LATEST}`,
    ),
  ]);
  const item = stock.items.find((i) => i.id === params.id);
  if (!item) throw new Response('No such stock line', { status: 404 });
  if (!moves.ok) throw new Response(moves.message, { status: moves.status });
  return { item, movements: moves.data };
}

/** The line's restock limits (stock.manage). */
export async function action({ request, params, context }: Route.ActionArgs) {
  const form = await request.formData();
  return save(
    SaveStockItemDto,
    {
      hex: text(form, 'hex'),
      lowStockGrams: text(form, 'lowStockGrams'),
      spoolGrams: text(form, 'spoolGrams'),
      leadTimeDays: text(form, 'leadTimeDays'),
      coverDays: text(form, 'coverDays'),
      active: checked(form, 'active'),
    },
    (dto) =>
      context
        .get(apiContext)
        .put(`/stock/items/${encodeURIComponent(params.id)}`, dto),
  );
}

export default function StockLine({ loaderData }: Route.ComponentProps) {
  const { item: i, movements } = loaderData;
  const manage = useCan()('stock.manage');
  const value = (i.stockGrams * Number(i.costPerGram)).toFixed(2);
  return (
    <>
      <AdminHeader
        title={filament(i)}
        intro={`${i.material.name}: what is on the shelf, how fast it goes and when to buy more.`}
        trail={[{ label: 'Filament stock', to: '/admin/stock' }]}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel title="On the shelf">
            <div className="flex items-center gap-3">
              <Swatch hex={i.swatchHex} large />
              <p className="font-display text-3xl font-bold tabular-nums">
                {grams(i.stockGrams)}
              </p>
              <span className="ml-auto">
                <StockBadge item={i} />
              </span>
            </div>
            <StockMeter item={i} />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              <Stat label="Available">{grams(i.availableGrams)}</Stat>
              <Stat label="For open orders">{grams(i.committedGrams)}</Stat>
              <Stat label="Worth">
                <Money amount={value} />
              </Stat>
              <Stat label="Cost per gram">
                ${Number(i.costPerGram).toFixed(3)}
              </Stat>
              <Stat label="Spools">
                {(i.stockGrams / i.spoolGrams).toFixed(1)}
              </Stat>
              <Stat label="Daily use">{i.dailyUseGrams} g</Stat>
              <Stat label="Used, last 30 days">{grams(i.used30Grams)}</Stat>
              <Stat label="Used, last 90 days">{grams(i.used90Grams)}</Stat>
              <Stat label="Lasts">
                {i.daysLeft === null ? '—' : `about ${i.daysLeft} days`}
              </Stat>
              <Stat label="Restock at">{grams(i.reorderPointGrams)}</Stat>
            </dl>
            {i.needsRestock && (
              <p className="rounded-md border border-warning px-3 py-2 text-sm">
                To restock: buy{' '}
                <strong>
                  {i.suggestSpools} spool{i.suggestSpools === 1 ? '' : 's'} (
                  {grams(i.suggestGrams)})
                </strong>
                .
              </p>
            )}
            <p className="text-xs text-text-muted">
              Available = on the shelf − what orders not yet in production will
              take. Daily use is the busier of the last 30 and 90 days; restock
              comes at your low level plus what is used while a delivery comes.
            </p>
          </Panel>

          <Panel title="Movements">
            <MovementTable movements={movements.items} />
            {movements.hasMore && (
              <Link
                to={`/admin/stock/movements?filter=${encodeURIComponent(lineFilter(i.id))}`}
                className="text-sm underline underline-offset-4"
              >
                All its movements
              </Link>
            )}
          </Panel>
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          {manage && (
            <Panel title="Record">
              <div className="grid grid-cols-1 gap-2">
                {STOCK_ACTIONS.map((a) => (
                  <Link
                    key={a.path}
                    to={`${a.path}?line=${encodeURIComponent(i.id)}`}
                    className={buttonClass('secondary')}
                  >
                    {a.label}
                  </Link>
                ))}
              </div>
            </Panel>
          )}
          <Panel title="Restock limits">
            <ViewOnly editable={manage}>
              <LimitsForm item={i} />
            </ViewOnly>
          </Panel>
        </div>
      </div>
      <div className="mt-8 border-t border-border pt-4">
        <DeleteRecord kind="stockItem" id={i.id} what={'this filament line'} />
      </div>
    </>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

function LimitsForm({ item: i }: { item: StockItemView }) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <fetcher.Form method="post" className="grid grid-cols-1 gap-3">
      <Field
        label="Low level (g)"
        name="lowStockGrams"
        type="number"
        min={0}
        defaultValue={i.lowStockGrams}
        error={errors['lowStockGrams']}
        hint="Keep at least this much"
      />
      <Field
        label="Spool size (g)"
        name="spoolGrams"
        type="number"
        min={1}
        defaultValue={i.spoolGrams}
        error={errors['spoolGrams']}
      />
      <Field
        label="Delivery takes (days)"
        name="leadTimeDays"
        type="number"
        min={0}
        defaultValue={i.leadTimeDays}
        error={errors['leadTimeDays']}
      />
      <Field
        label="Buy enough for (days)"
        name="coverDays"
        type="number"
        min={0}
        defaultValue={i.coverDays}
        error={errors['coverDays']}
      />
      {i.colour && <ColourLook initial={i.hex ?? i.swatchHex} />}
      <CheckboxField
        label="Track this filament"
        name="active"
        defaultChecked={i.active}
        hint="Untick a colour you no longer sell: it is never flagged."
      />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={fetcher.state !== 'idle'}>
          Save
        </Button>
        <SaveStatus state={fetcher.state} result={fetcher.data} />
      </div>
    </fetcher.Form>
  );
}

function MovementTable({
  movements,
}: {
  movements: readonly StockMovementView[];
}) {
  if (movements.length === 0)
    return (
      <p className="text-sm text-text-muted">
        No movements of this filament yet.
      </p>
    );
  return (
    <div className="max-h-[32rem] overflow-auto">
      <table aria-label="Movements" className="w-full text-sm">
        <thead className="text-left text-text-muted">
          <tr>
            {['When', 'What', 'Grams', 'Cost', 'For', 'By'].map((h) => (
              <th key={h} className="py-2 pr-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {movements.map((m) => (
            <tr key={m.id} className="border-t border-border">
              <td className="py-2 pr-4 whitespace-nowrap">
                {STOCK_TIME.format(new Date(m.createdAt))}
              </td>
              <td className="py-2 pr-4 whitespace-nowrap">
                {STOCK_MOVEMENT_LABELS[m.kind]}
              </td>
              <td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums">
                <SignedGrams value={m.grams} />
              </td>
              <td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums">
                {m.cost !== null ? <Money amount={m.cost} /> : '—'}
              </td>
              <td className="py-2 pr-4">{movementFor(m)}</td>
              <td className="py-2">{m.by ?? 'Automatic'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
