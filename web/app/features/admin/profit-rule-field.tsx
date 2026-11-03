import type { ProfitKind } from '@forgea/types';
import { useId } from 'react';
import { Field } from '~/components/ui/field';

/** The rule as edited: a percentage, a fixed amount, or (on a product) the shop's. */
type ProfitChoice = ProfitKind | 'SHOP';

export interface ProfitValue {
  kind: ProfitChoice;
  value: string;
}

/** "150% of cost" / "$4.00 a piece": the rule in words. */
export function describeProfit(kind: ProfitKind, value: string): string {
  return kind === 'PERCENT'
    ? `${Number(value)}% of the cost`
    : `$${Number(value).toFixed(2)} a piece`;
}

/**
 * What the studio earns on top of cost: a percentage of it ("100%" doubles the cost) or the
 * same amount on every piece. On a product, `shop` adds "the shop's rule" (Pricing page).
 * Submits `profitKind` and `profitValue`; with the shop's rule, neither.
 */
export function ProfitRuleField({
  value,
  onChange,
  shop,
  errors = {},
  disabled = false,
}: {
  value: ProfitValue;
  onChange: (next: ProfitValue) => void;
  /** The shop's rule, offered as a choice (on a product). */
  shop?: { kind: ProfitKind; value: string };
  errors?: Partial<Record<string, string>>;
  disabled?: boolean;
}) {
  const id = useId();
  const choices: [ProfitChoice, string][] = [
    ...(shop
      ? [
          [
            'SHOP',
            `The shop's rule (${describeProfit(shop.kind, shop.value)})`,
          ] as [ProfitChoice, string],
        ]
      : []),
    ['PERCENT', 'A percentage of the cost'],
    ['FIXED', 'A fixed amount on every piece'],
  ];
  return (
    <fieldset className="grid gap-3" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium">Your profit</legend>
      <div className="grid gap-2 text-sm" role="radiogroup">
        {choices.map(([kind, label]) => (
          <label key={kind} className="flex items-center gap-2">
            <input
              type="radio"
              name={`${id}-profit-kind`}
              checked={value.kind === kind}
              onChange={() => onChange({ ...value, kind })}
            />
            {label}
          </label>
        ))}
      </div>
      {value.kind !== 'SHOP' && (
        <>
          <input type="hidden" name="profitKind" value={value.kind} />
          <Field
            label={value.kind === 'PERCENT' ? 'Profit (%)' : 'Profit (USD)'}
            name="profitValue"
            inputMode="decimal"
            required
            value={value.value}
            onChange={(e) =>
              onChange({ ...value, value: e.currentTarget.value })
            }
            error={errors['profitValue']}
            hint={
              value.kind === 'PERCENT'
                ? 'e.g. 100 doubles the cost: a $5 piece sells at $10'
                : 'e.g. 4 adds $4 to what each piece costs you'
            }
          />
        </>
      )}
      {errors['profitKind'] && (
        <p className="text-sm text-danger">{errors['profitKind']}</p>
      )}
    </fieldset>
  );
}
