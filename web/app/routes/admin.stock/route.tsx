import {
  MANUAL_STOCK_MOVEMENTS,
  type MaterialView,
  STOCK_MOVEMENT_LABELS,
  type StockItemView,
  type StockOverview,
} from '@forgea/types';
import { RecordStockMovementDto, SaveStockItemDto } from '@forgea/validation';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import {
  CheckboxField,
  Field,
  FormAlert,
  SelectField,
} from '~/components/ui/field';
import { useCan } from '~/features/admin/access';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { formatRange, PeriodPicker } from '~/features/admin/period-picker';
import {
  checked,
  type SaveResult,
  save,
  text,
} from '~/features/admin/staff.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const today = new Date().toISOString().slice(0, 10);
  const query = new URLSearchParams();
  for (const key of ['from', 'to']) {
    const value = url.searchParams.get(key);
    if (value) query.set(key, value);
  }
  const asked = query.size ? `?${query}` : '';
  const [first, materials] = await Promise.all([
    api.get<StockOverview>(`/stock${asked}`),
    api.get<MaterialView[]>('/materials'),
  ]);
  let stock = first;
  let error: string | null = null;
  if (!stock.ok && stock.status === 400 && asked) {
    error = stock.message;
    stock = await api.get<StockOverview>('/stock');
  }
  if (!stock.ok) throw new Response(stock.message, { status: stock.status });
  if (!materials.ok)
    throw new Response(materials.message, { status: materials.status });
  return {
    stock: stock.data,
    materials: materials.data.filter((m) => m.active),
    today,
    error,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  if (form.get('intent') === 'limits') {
    const id = text(form, 'id') ?? '';
    return save(
      SaveStockItemDto,
      {
        lowStockGrams: text(form, 'lowStockGrams'),
        spoolGrams: text(form, 'spoolGrams'),
        leadTimeDays: text(form, 'leadTimeDays'),
        coverDays: text(form, 'coverDays'),
        active: checked(form, 'active'),
      },
      (dto) => api.put(`/stock/items/${encodeURIComponent(id)}`, dto),
    );
  }
  return save(
    RecordStockMovementDto,
    {
      materialId: text(form, 'materialId'),
      colour: text(form, 'colour') ?? '',
      kind: text(form, 'kind'),
      grams: text(form, 'grams'),
      note: text(form, 'note'),
    },
    (dto) => api.post('/stock/movements', dto),
  );
}

const grams = (g: number) => `${g.toLocaleString('en-US')} g`;
const filament = (i: { material: { code: string }; colour: string }) =>
  `${i.material.code} ${i.colour || '(any colour)'}`;
const TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Beirut',
});

export default function Stock({ loaderData }: Route.ComponentProps) {
  const { stock, materials, today, error } = loaderData;
  const can = useCan();
  const manage = can('stock.manage');
  const restock = stock.items.filter((i) => i.needsRestock);
  return (
    <>
      <AdminHeader
        title="Filament stock"
        intro="What is on the shelf for each material and colour, what open orders will take, how long it lasts at your pace, and what to buy. Orders take their filament when they go into production."
      />
      <FormAlert message={error ?? undefined} />

      <Panel title="To restock" className="mb-6">
        {restock.length === 0 ? (
          <p className="text-sm text-text-muted">
            Nothing to buy now: every filament is above its reorder point.
          </p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {restock.map((i) => (
              <li key={i.id} className="flex flex-wrap justify-between gap-x-4">
                <span className="font-semibold">{filament(i)}</span>
                <span>
                  {grams(i.availableGrams)} available
                  {i.daysLeft !== null && `, about ${i.daysLeft} days`} · buy{' '}
                  <strong>
                    {i.suggestSpools} spool{i.suggestSpools === 1 ? '' : 's'} (
                    {grams(i.suggestGrams)})
                  </strong>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {manage && <RecordForm materials={materials} items={stock.items} />}

      <Panel title="On the shelf" className="mb-6">
        <p className="text-sm text-text-muted">
          Available = on the shelf − what orders not yet in production will
          take. Daily use is the busier of the last 30 and 90 days. Reorder at
          your low level plus what is used while a delivery comes; the
          suggestion covers the extra days you set, in whole spools.
        </p>
        {stock.items.length === 0 ? (
          <p className="text-sm text-text-muted">No filament recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-text-muted">
                <tr>
                  {[
                    'Filament',
                    'On the shelf',
                    'For open orders',
                    'Available',
                    'Use a day',
                    'Days left',
                    'Reorder at',
                    '',
                  ].map((h) => (
                    <th
                      key={h}
                      className="py-2 pr-4 font-medium whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stock.items.map((i) => (
                  <ItemRow key={i.id} item={i} manage={manage} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Filament used by product" className="mb-6">
        <PeriodPicker range={stock.usage.range} today={today} />
        <p className="text-sm text-text-muted">
          Taken out of stock by orders going into production,{' '}
          {formatRange(stock.usage.range)}.
        </p>
        {stock.usage.rows.length === 0 ? (
          <p className="text-sm text-text-muted">
            No orders went into production then.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-text-muted">
                <tr>
                  <th className="py-2 pr-4 font-medium">Product</th>
                  <th className="py-2 pr-4 font-medium">Filament</th>
                  <th className="py-2 text-right font-medium">Used</th>
                </tr>
              </thead>
              <tbody>
                {stock.usage.rows.map((r) => (
                  <tr
                    key={`${r.productId}:${r.materialCode}:${r.colour}`}
                    className="border-t border-border"
                  >
                    <td className="py-2 pr-4">{r.product}</td>
                    <td className="py-2 pr-4">
                      {r.materialCode} {r.colour || '(any colour)'}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {grams(r.grams)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Latest movements">
        {stock.movements.length === 0 ? (
          <p className="text-sm text-text-muted">Nothing recorded yet.</p>
        ) : (
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-text-muted">
                <tr>
                  {['When', 'What', 'Filament', 'Grams', 'Note', 'By'].map(
                    (h) => (
                      <th key={h} className="py-2 pr-4 font-medium">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {stock.movements.map((m) => (
                  <tr key={m.id} className="border-t border-border">
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {TIME.format(new Date(m.createdAt))}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {STOCK_MOVEMENT_LABELS[m.kind]}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {m.materialCode} {m.colour || '(any colour)'}
                    </td>
                    <td
                      className={`py-2 pr-4 text-right tabular-nums ${m.grams < 0 ? 'text-danger' : 'text-success'}`}
                    >
                      {m.grams > 0 ? '+' : '−'}
                      {grams(Math.abs(m.grams))}
                    </td>
                    <td className="py-2 pr-4">
                      {m.note ?? m.orderNumber ?? ''}
                    </td>
                    <td className="py-2">{m.by ?? 'Automatic'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function ItemRow({
  item: i,
  manage,
}: {
  item: StockItemView;
  manage: boolean;
}) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <>
      <tr
        className={`border-t border-border ${i.active ? '' : 'text-text-muted'}`}
      >
        <td className="py-2 pr-4 whitespace-nowrap">
          <span className="font-medium">{filament(i)}</span>
          {i.needsRestock && (
            <span className="ml-2 rounded-pill bg-warning px-2 py-0.5 text-xs text-background">
              restock
            </span>
          )}
          {!i.active && <span className="ml-2 text-xs">(not tracked)</span>}
        </td>
        <td className="py-2 pr-4 tabular-nums">{grams(i.stockGrams)}</td>
        <td className="py-2 pr-4 tabular-nums">{grams(i.committedGrams)}</td>
        <td className="py-2 pr-4 tabular-nums">{grams(i.availableGrams)}</td>
        <td className="py-2 pr-4 tabular-nums">{i.dailyUseGrams} g</td>
        <td className="py-2 pr-4 tabular-nums">{i.daysLeft ?? '—'}</td>
        <td className="py-2 pr-4 tabular-nums">{grams(i.reorderPointGrams)}</td>
        <td className="py-2">
          {manage && (
            <details>
              <summary className="cursor-pointer text-text-muted">
                Limits
              </summary>
              <fetcher.Form method="post" className="mt-2 grid min-w-64 gap-3">
                <input type="hidden" name="intent" value="limits" />
                <input type="hidden" name="id" value={i.id} />
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
            </details>
          )}
        </td>
      </tr>
    </>
  );
}

function RecordForm({
  materials,
  items,
}: {
  materials: MaterialView[];
  items: StockItemView[];
}) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  const colours = [
    ...new Set(items.map((i) => i.colour).filter(Boolean)),
  ].sort();
  return (
    <Panel title="Record filament in or out" className="mb-6">
      <fetcher.Form
        method="post"
        key={fetcher.data?.ok ? 'reset' : 'form'}
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <SelectField
          label="Material"
          name="materialId"
          required
          error={errors['materialId']}
        >
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.code})
            </option>
          ))}
        </SelectField>
        <Field
          label="Colour (optional)"
          name="colour"
          list="stock-colours"
          error={errors['colour']}
          hint="As the shop names it; empty when it doesn't matter"
        />
        <datalist id="stock-colours">
          {colours.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <SelectField label="What happened" name="kind" error={errors['kind']}>
          {MANUAL_STOCK_MOVEMENTS.map((k) => (
            <option key={k} value={k}>
              {STOCK_MOVEMENT_LABELS[k]}
            </option>
          ))}
        </SelectField>
        <Field
          label="Grams"
          name="grams"
          type="number"
          required
          error={errors['grams']}
          hint="A delivery or use: how many. A count correction: the difference (+ or −)."
        />
        <Field
          label="Note (optional)"
          name="note"
          error={errors['note']}
          hint="e.g. 3 spools from the supplier"
        />
        <div className="flex items-end gap-3">
          <Button type="submit" disabled={fetcher.state !== 'idle'}>
            Record
          </Button>
          <SaveStatus state={fetcher.state} result={fetcher.data} />
        </div>
      </fetcher.Form>
    </Panel>
  );
}
