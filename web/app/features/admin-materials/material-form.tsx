import type { MaterialView } from '@forgea/types';
import { pricePerGramFromReel } from '@forgea/pricing';
import { useState } from 'react';
import { Link, useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { CheckboxField, Field } from '~/components/ui/field';
import { Panel, SaveStatus } from '~/features/admin/admin-ui';
import type { SaveResult } from '~/features/admin/staff.server';

/** "$22 a 1 kg spool". */
export function reelText(m: MaterialView): string | null {
  if (!m.reelPrice || !m.reelGrams) return null;
  const weight =
    m.reelGrams >= 1000 ? `${m.reelGrams / 1000} kg` : `${m.reelGrams} g`;
  return `$${m.reelPrice} a ${weight} spool`;
}

/** In use and at or below its warning limit. */
export const isLowStock = (m: MaterialView) =>
  m.active && m.stockGrams <= m.lowStockThresholdGrams;

/**
 * A material's form (new or existing): what it is, what a gram costs, how it prints and its
 * stock. Stock only moves by recorded movements, so an existing one shows it read-only.
 */
export function MaterialForm({ material }: { material?: MaterialView }) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <fetcher.Form method="post" className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Material">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Code"
              name="code"
              required
              defaultValue={material?.code}
              error={errors['code']}
              hint="e.g. PLA, PETG-CF"
            />
            <Field
              label="Name"
              name="name"
              required
              defaultValue={material?.name}
              error={errors['name']}
            />
          </div>
          <CheckboxField
            label="In use"
            name="active"
            defaultChecked={material?.active ?? true}
          />
        </Panel>
        <Panel title="Cost">
          <ReelFields material={material} errors={errors} />
        </Panel>
        <Panel title="Printing">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Density (g/cm³)"
              name="densityGPerCm3"
              inputMode="decimal"
              defaultValue={material?.densityGPerCm3 ?? '1.24'}
              error={errors['densityGPerCm3']}
              hint="PLA 1.24 · PETG 1.27 · ASA 1.07"
            />
            <Field
              label="Prints per hour (g)"
              name="gramsPerHour"
              inputMode="decimal"
              defaultValue={material?.gramsPerHour ?? '12'}
              error={errors['gramsPerHour']}
              hint="Your printers' average"
            />
          </div>
        </Panel>
        <Panel title="Stock">
          <div className="grid gap-4 sm:grid-cols-2">
            {material ? (
              // Stock moves only by recorded movements (deliveries, orders, counts).
              <div className="grid content-start gap-1.5 text-sm">
                <input
                  type="hidden"
                  name="stockGrams"
                  value={material.stockGrams}
                />
                <span className="font-medium">On the shelf</span>
                <span className="flex flex-wrap items-center gap-2">
                  <strong className="tabular-nums">
                    {material.stockGrams.toLocaleString('en-US')} g
                  </strong>
                  {isLowStock(material) && <LowStockBadge />}
                </span>
                <Link to="/admin/stock" className="underline">
                  Spools in and out, counts
                </Link>
              </div>
            ) : (
              <Field
                label="Already on the shelf (g)"
                name="stockGrams"
                type="number"
                min={0}
                defaultValue={0}
                error={errors['stockGrams']}
                hint="Optional: later spools go in on the Stock page"
              />
            )}
            <Field
              label="New colours warn below (g)"
              name="lowStockThresholdGrams"
              type="number"
              min={0}
              defaultValue={material?.lowStockThresholdGrams ?? 1000}
              error={errors['lowStockThresholdGrams']}
              hint="Each colour’s own limit is on the Stock page"
            />
          </div>
        </Panel>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={fetcher.state !== 'idle'}>
          {material ? 'Save' : 'Add material'}
        </Button>
        <SaveStatus state={fetcher.state} result={fetcher.data} />
      </div>
    </fetcher.Form>
  );
}

export function LowStockBadge() {
  return (
    <span className="rounded-pill bg-warning px-2 py-0.5 text-xs text-background">
      low stock
    </span>
  );
}

/**
 * One reel as you buy it: what it costs and what it weighs. The cost of a gram follows, shown
 * as you type; the API works it out the same way when you save.
 */
function ReelFields({
  material,
  errors,
}: {
  material?: MaterialView | undefined;
  errors: Partial<Record<string, string>>;
}) {
  const [price, setPrice] = useState(material?.reelPrice ?? '');
  const [grams, setGrams] = useState(
    material?.reelGrams ? String(material.reelGrams) : '1000',
  );
  let perGram: string | null = null;
  try {
    if (price.trim() && grams.trim())
      perGram = pricePerGramFromReel(price, grams);
  } catch {
    perGram = null;
  }
  return (
    <div className="grid content-start gap-2">
      <div className="grid grid-cols-2 gap-2">
        <Field
          label="A reel costs (USD)"
          name="reelPrice"
          inputMode="decimal"
          required
          value={price}
          onChange={(e) => setPrice(e.currentTarget.value)}
          error={errors['reelPrice']}
          hint="What you pay for one"
        />
        <Field
          label="A reel weighs (g)"
          name="reelGrams"
          inputMode="numeric"
          required
          value={grams}
          onChange={(e) => setGrams(e.currentTarget.value)}
          error={errors['reelGrams']}
          hint="Filament only, e.g. 1000"
        />
      </div>
      <p className="text-sm" aria-live="polite">
        {perGram ? (
          <>
            A gram costs you <strong>${perGram}</strong>
          </>
        ) : (
          <span className="text-text-muted">
            Fill in both to see what a gram costs.
          </span>
        )}
      </p>
    </div>
  );
}
