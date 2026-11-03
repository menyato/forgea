import type { PricePreview, ProfitKind } from '@forgea/types';
import { useEffect } from 'react';
import { useFetcher } from 'react-router';
import { Money } from '~/components/money';
import {
  describeProfit,
  ProfitRuleField,
  type ProfitValue,
} from '~/features/admin/profit-rule-field';

/**
 * The product's price as it is being edited: its profit rule, and what it would sell at,
 * worked out by the API from the material, grams and hours (with the cost breakdown for
 * whoever manages pricing). Without that permission the rule is shown, kept as it is.
 */
export function PricePanel({
  materialId,
  grams,
  printHours,
  profit,
  onProfit,
  shopProfit,
  errors,
}: {
  materialId: string;
  grams: string;
  printHours: string;
  profit: ProfitValue;
  onProfit: (next: ProfitValue) => void;
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
  const ask = JSON.stringify({ materialId, grams, printHours, ...rule });
  // Re-priced a moment after the last change.
  useEffect(() => {
    const values = JSON.parse(ask) as Record<string, string>;
    if (!values['materialId'] || !values['grams'] || !values['printHours'])
      return;
    const timer = setTimeout(
      () => void submit({ intent: 'preview', ...values }, { method: 'post' }),
      300,
    );
    return () => clearTimeout(timer);
  }, [ask, submit]);
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
      <div aria-live="polite" className="grid gap-1 text-sm">
        {b ? (
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
            {(
              [
                ['Filament', b.material],
                ['Printer time', b.printer],
                ['Waste and failed prints', b.wasteAndFailures],
                ['Labour', b.labour],
                ['Packaging', b.packaging],
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
                with the default options; sizes and options adjust it
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
