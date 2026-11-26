import {
  PRICE_LINES,
  type PriceLine,
  type PricePreview,
  type ProfitKind,
} from '@forgea/types';
import { useEffect, useState } from 'react';
import { useFetcher } from 'react-router';
import { Money } from '~/components/money';
import { CheckboxField, Field } from '~/components/ui/field';
import {
  describeProfit,
  ProfitRuleField,
  type ProfitValue,
} from '~/features/admin/profit-rule-field';

/**
 * The product's price as it is being edited: its profit rule, and what it would sell at,
 * worked out by the API from the material, grams and hours (with the cost breakdown for
 * whoever manages pricing). Whoever manages pricing may also set their own price: the
 * calculation stays in view beside it, and unticking goes back to the calculated price.
 * Without that permission the rule and the price are shown, kept as they are.
 */
export function PricePanel({
  materialId,
  grams,
  printHours,
  modelFileKey,
  printFileKeys,
  colours,
  profit,
  onProfit,
  priceOverride,
  onPriceOverride,
  extraCosts,
  onExtraCosts,
  priceLinesOff,
  onPriceLinesOff,
  shopProfit,
  errors,
  onPricing,
}: {
  /** Told while a price is being asked for: the form saves once it has answered. */
  onPricing: (pricing: boolean) => void;
  /** What else one piece costs (a key ring, a lamp's wiring): pricing.manage only. */
  extraCosts: readonly { label: string; amount: string }[];
  onExtraCosts: (next: { label: string; amount: string }[]) => void;
  /** The shop's lines this product leaves out (no packaging…): pricing.manage only. */
  priceLinesOff: readonly PriceLine[];
  onPriceLinesOff: (next: PriceLine[]) => void;
  materialId: string;
  grams: string;
  printHours: string;
  /** A sliced 3MF whose own grams these are: its purge, tower and supports are in them. */
  modelFileKey: string | null;
  /** Its sliced print files: numbers that are their total hold the slicer's waste too. */
  printFileKeys: readonly string[];
  /** Its colours' grams and filaments: each filament's own price counts in the cost. */
  colours: readonly { grams: string; stockItemId: string | null }[];
  profit: ProfitValue;
  onProfit: (next: ProfitValue) => void;
  /** The owner's own price ('' = the calculated one). */
  priceOverride: string;
  onPriceOverride: (next: string) => void;
  /** The shop's rule; null when the editor may not see or change pricing. */
  shopProfit: { kind: ProfitKind; value: string } | null;
  errors: Partial<Record<string, string>>;
}) {
  const preview = useFetcher<{ preview: PricePreview | null }>();
  const { submit } = preview;
  const rule =
    profit.kind === 'SHOP'
      ? {}
      : { profitKind: profit.kind, profitValue: profit.value };
  const ask = JSON.stringify({
    materialId,
    grams,
    printHours,
    ...(modelFileKey ? { modelFileKey } : {}),
    ...(printFileKeys.length > 0
      ? { printFileKeys: JSON.stringify(printFileKeys) }
      : {}),
    ...(colours.some((c) => c.stockItemId)
      ? {
          colours: JSON.stringify(
            colours.map((c) => ({
              grams: c.grams,
              ...(c.stockItemId ? { stockItemId: c.stockItemId } : {}),
            })),
          ),
        }
      : {}),
    ...rule,
    ...(priceOverride ? { priceOverride } : {}),
    // Only complete rows price anything (a row being typed waits).
    ...(extraCosts.some((e) => e.label.trim() && e.amount)
      ? {
          extraCosts: JSON.stringify(
            extraCosts.filter((e) => e.label.trim() && e.amount),
          ),
        }
      : {}),
    ...(priceLinesOff.length > 0
      ? { priceLinesOff: JSON.stringify(priceLinesOff) }
      : {}),
  });
  // What the latest request asked: until it is this form's, a price is on its way.
  const [asked, setAsked] = useState<string | null>(null);
  const priceable = Boolean(materialId && grams && printHours);
  // Re-priced a moment after the last change.
  useEffect(() => {
    if (!priceable) return;
    const timer = setTimeout(() => {
      setAsked(ask);
      void submit(
        { intent: 'preview', ...(JSON.parse(ask) as Record<string, string>) },
        { method: 'post' },
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [ask, submit, priceable]);
  // A save sent while a price request is out would have its move to the saved product
  // cut short by the answer, so the form waits the moment it takes.
  const pricing = (priceable && asked !== ask) || preview.state !== 'idle';
  useEffect(() => onPricing(pricing), [onPricing, pricing]);
  const p = preview.data?.preview;
  const b = p?.breakdown;

  return (
    <div className="grid gap-4 rounded-md border border-border p-4">
      {shopProfit ? (
        <ProfitRuleField
          value={profit}
          onChange={onProfit}
          shop={shopProfit}
          errors={errors}
        />
      ) : (
        <p className="text-sm text-text-muted">
          Profit:{' '}
          {profit.kind === 'SHOP'
            ? "the shop's rule"
            : describeProfit(profit.kind, profit.value)}{' '}
          (set by whoever manages pricing).
          {profit.kind !== 'SHOP' && (
            <>
              <input type="hidden" name="profitKind" value={profit.kind} />
              <input type="hidden" name="profitValue" value={profit.value} />
            </>
          )}
        </p>
      )}
      <OwnPrice
        value={priceOverride}
        onChange={onPriceOverride}
        mayPrice={shopProfit !== null}
        error={errors['priceOverride']}
      />
      <ShopLines
        value={priceLinesOff}
        onChange={onPriceLinesOff}
        mayPrice={shopProfit !== null}
      />
      <ExtraCosts
        value={extraCosts}
        onChange={onExtraCosts}
        mayPrice={shopProfit !== null}
        error={
          Object.entries(errors).find(([k]) => k.startsWith('extraCosts'))?.[1]
        }
      />
      <div aria-live="polite" className="grid gap-1 text-sm">
        {b ? (
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
            {(
              [
                ['Filament', b.material],
                ...(b.printerWear !== null && b.electricity !== null
                  ? ([
                      ['Printer wear', b.printerWear],
                      ['Electricity', b.electricity],
                    ] as const)
                  : ([['Printer time', b.printer]] as const)),
                [
                  p?.wasteIncluded
                    ? 'Failed prints (purge, tower and supports are in the sliced grams)'
                    : 'Waste and failed prints',
                  b.wasteAndFailures,
                ],
                ['Labour', b.labour],
                ['Packaging', b.packaging],
                ...(Number(b.extras) > 0
                  ? ([['Extra parts', b.extras]] as const)
                  : []),
              ] as const
            ).map(([label, amount]) => (
              <div key={label} className="contents">
                <dt className="text-text-muted">{label}</dt>
                <dd className="text-right tabular-nums">
                  <Money amount={amount} />
                </dd>
              </div>
            ))}
            <dt className="border-t border-border pt-1 font-medium">
              It costs you
            </dt>
            <dd className="border-t border-border pt-1 text-right font-medium tabular-nums">
              <Money amount={b.cost} />
            </dd>
            <dt className="text-text-muted">
              Your profit (
              {describeProfit(b.profitRule.kind, b.profitRule.value)})
            </dt>
            <dd className="text-right tabular-nums">
              <Money amount={b.profit} />
            </dd>
          </dl>
        ) : null}
        <p className="text-base font-semibold">
          {p ? (
            <>
              Sells at <Money amount={p.unitPrice} />
              <span className="ml-2 text-sm font-normal text-text-muted">
                {priceOverride ? (
                  <>
                    your price; calculated: <Money amount={p.calculatedPrice} />
                    . Sizes and options add what they change in the calculated
                    price
                  </>
                ) : (
                  'with the default options; sizes and options adjust it'
                )}
              </span>
            </>
          ) : preview.state !== 'idle' ? (
            <span className="text-sm font-normal text-text-muted">
              Working out the price…
            </span>
          ) : (
            <span className="text-sm font-normal text-text-muted">
              Fill in the material, grams and print time to see the price.
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * The shop's price lines, each ticked while this product counts it: untick packaging for a
 * piece sold without a box, profit for one sold at cost. Unticked lines count 0 in its price
 * and in its cost. Only whoever manages pricing may change them.
 */
function ShopLines({
  value,
  onChange,
  mayPrice,
}: {
  value: readonly PriceLine[];
  onChange: (next: PriceLine[]) => void;
  mayPrice: boolean;
}) {
  const field = (
    <input type="hidden" name="priceLinesOff" value={JSON.stringify(value)} />
  );
  if (!mayPrice)
    return value.length > 0 ? (
      <p className="text-sm text-text-muted">
        Left out of its price:{' '}
        {PRICE_LINES.filter((l) => value.includes(l.key))
          .map((l) => l.label.toLowerCase())
          .join(', ')}{' '}
        (set by whoever manages pricing).
        {field}
      </p>
    ) : null;
  return (
    <fieldset className="grid min-w-0 gap-2">
      <legend className="mb-1 text-sm font-medium">
        The shop&apos;s rules this product counts
      </legend>
      {field}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
        {PRICE_LINES.map((l) => (
          <CheckboxField
            key={l.key}
            label={l.label}
            name={`price-line-${l.key}`}
            checked={!value.includes(l.key)}
            onChange={(e) => {
              const on = e.currentTarget.checked;
              onChange(
                PRICE_LINES.map((x) => x.key).filter((k) =>
                  k === l.key ? !on : value.includes(k),
                ),
              );
            }}
          />
        ))}
      </div>
      <p className="text-xs text-text-muted">
        Untick what this product doesn&apos;t take (no packaging, sold at
        cost…): it counts 0 in its price and its cost.
      </p>
    </fieldset>
  );
}

/**
 * What else one piece costs besides the print (a key ring, a lamp's cable and bulb holder):
 * added to its cost, so the profit rule applies to it too. Only whoever manages pricing may
 * change them; anyone else sees them and keeps them as they are.
 */
function ExtraCosts({
  value,
  onChange,
  mayPrice,
  error,
}: {
  value: readonly { label: string; amount: string }[];
  onChange: (next: { label: string; amount: string }[]) => void;
  mayPrice: boolean;
  error: string | undefined;
}) {
  const rows = value.filter((e) => e.label.trim() && e.amount);
  const field = (
    <input type="hidden" name="extraCosts" value={JSON.stringify(rows)} />
  );
  if (!mayPrice)
    return rows.length > 0 ? (
      <p className="text-sm text-text-muted">
        Extra costs: {rows.map((e) => `${e.label} $${e.amount}`).join(', ')}{' '}
        (set by whoever manages pricing).
        {field}
      </p>
    ) : null;
  const set = (i: number, next: { label: string; amount: string }) =>
    onChange(value.map((e, j) => (j === i ? next : e)));
  return (
    <fieldset className="grid min-w-0 gap-2">
      <legend className="mb-1 text-sm font-medium">
        Extra costs for one piece
      </legend>
      {field}
      {value.map((e, i) => (
        <div
          key={i}
          className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-end gap-2"
        >
          <Field
            label={`Extra cost ${i + 1}`}
            name={`extra-cost-label-${i}`}
            autoComplete="off"
            placeholder="e.g. Key ring"
            value={e.label}
            onChange={(ev) => set(i, { ...e, label: ev.currentTarget.value })}
          />
          <Field
            label="USD"
            name={`extra-cost-amount-${i}`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.15"
            value={e.amount}
            onChange={(ev) =>
              set(i, { ...e, amount: ev.currentTarget.value.trim() })
            }
          />
          <button
            type="button"
            className="mb-2 text-sm text-text-muted hover:text-danger"
            aria-label={`Remove extra cost ${i + 1}`}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="justify-self-start text-sm underline underline-offset-4"
        onClick={() => onChange([...value, { label: '', amount: '' }])}
      >
        Add an extra cost
      </button>
      <p className="text-xs text-text-muted">
        Parts besides the print, e.g. a key ring or a lamp&apos;s wiring: added
        to what it costs you, so your profit applies to them too.
      </p>
      {error && <p className="text-sm text-danger">{error}</p>}
    </fieldset>
  );
}

/**
 * "Use my own price": the owner's price in place of the calculated one. Only whoever manages
 * pricing may change it; anyone else sees it and keeps it as it is.
 */
function OwnPrice({
  value,
  onChange,
  mayPrice,
  error,
}: {
  value: string;
  onChange: (next: string) => void;
  mayPrice: boolean;
  error: string | undefined;
}) {
  const [on, setOn] = useState(value !== '');
  if (!mayPrice) {
    return value ? (
      <p className="text-sm text-text-muted">
        Own price: <Money amount={value} /> (set by whoever manages pricing).
        <input type="hidden" name="priceOverride" value={value} />
      </p>
    ) : null;
  }
  return (
    <div className="grid gap-2">
      <CheckboxField
        label="Use my own price"
        name="usePriceOverride"
        checked={on}
        onChange={(e) => {
          const next = e.currentTarget.checked;
          setOn(next);
          if (!next) onChange('');
        }}
        hint="The calculation stays below for reference; untick to sell at it again"
      />
      {on && (
        <Field
          label="My price (USD)"
          name="priceOverride"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.currentTarget.value.trim())}
          error={error}
        />
      )}
    </div>
  );
}
