import type { CostSettings, OrderSettings } from '@forgea/pricing';
import { UpdatePricingSettingsDto } from '@forgea/validation';
import { useState } from 'react';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { jsonField } from '~/lib/forms.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

interface Settings {
  cost: CostSettings;
  order: OrderSettings;
}

export async function loader({ context }: Route.LoaderArgs) {
  const r = await context.get(apiContext).get<Settings>('/pricing/settings');
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { settings: r.data };
}

const FIELDS = [
  'machineRatePerHour',
  'purgeWastePercent',
  'failureAllowancePercent',
  'laborCostPerUnit',
  'packagingCostPerUnit',
  'markupMultiplier',
  'rushFeePercent',
  'deliveryFee',
  'depositPercent',
] as const;

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  return save(
    UpdatePricingSettingsDto,
    {
      ...Object.fromEntries(FIELDS.map((f) => [f, text(form, f)])),
      bulkDiscountTiers: jsonField(form, 'bulkDiscountTiers') ?? [],
    },
    (dto) => context.get(apiContext).put('/pricing/settings', dto),
  );
}

export default function Pricing({ loaderData }: Route.ComponentProps) {
  const { cost, order } = loaderData.settings;
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  const [tiers, setTiers] = useState(
    order.bulkDiscountTiers.map((t) => ({
      minQuantity: String(t.minQuantity),
      percent: String(t.percent),
    })),
  );
  const number = (
    name: (typeof FIELDS)[number],
    label: string,
    value: string | number,
    hint?: string,
  ) => (
    <Field
      label={label}
      name={name}
      inputMode="decimal"
      required
      defaultValue={String(value)}
      error={errors[name]}
      hint={hint}
    />
  );

  return (
    <>
      <AdminHeader
        title="Pricing"
        intro="How every price is worked out. Changes apply to the next price shown or quoted; orders already placed keep their prices. Every change is logged."
      />
      <fetcher.Form method="post" className="grid gap-6">
        <input
          type="hidden"
          name="bulkDiscountTiers"
          value={JSON.stringify(
            tiers.map((t) => ({
              minQuantity: Number(t.minQuantity),
              percent: t.percent,
            })),
          )}
        />
        <Panel title="What a print costs you">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {number(
              'machineRatePerHour',
              'Printer time (USD per hour)',
              cost.machineRatePerHour,
              'Electricity, wear and the printer itself',
            )}
            {number(
              'purgeWastePercent',
              'Purge and waste (%)',
              cost.purgeWastePercent,
            )}
            {number(
              'failureAllowancePercent',
              'Failed prints allowance (%)',
              cost.failureAllowancePercent,
            )}
            {number(
              'laborCostPerUnit',
              'Labour per piece (USD)',
              cost.laborCostPerUnit,
            )}
            {number(
              'packagingCostPerUnit',
              'Packaging per piece (USD)',
              cost.packagingCostPerUnit,
            )}
            {number(
              'markupMultiplier',
              'Markup (×)',
              cost.markupMultiplier,
              'Price = cost × this',
            )}
          </div>
        </Panel>
        <Panel title="What customers pay on top">
          <div className="grid gap-4 sm:grid-cols-3">
            {number('rushFeePercent', 'Rush fee (%)', order.rushFeePercent)}
            {number('deliveryFee', 'Delivery fee (USD)', order.deliveryFee)}
            {number(
              'depositPercent',
              'Deposit on made-to-order (%)',
              order.depositPercent,
            )}
          </div>
        </Panel>
        <Panel title="Bulk discounts">
          <p className="text-sm text-text-muted">
            A cart line of at least this many pieces gets the discount.
          </p>
          {tiers.map((t, i) => (
            <div key={i} className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1 text-sm">
                <span>From (pieces)</span>
                <input
                  type="number"
                  min={2}
                  value={t.minQuantity}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    setTiers((all) =>
                      all.map((x, j) =>
                        j === i ? { ...x, minQuantity: v } : x,
                      ),
                    );
                  }}
                  className="w-28 rounded-md border border-border bg-surface px-2 py-1.5"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span>Discount (%)</span>
                <input
                  inputMode="decimal"
                  value={t.percent}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    setTiers((all) =>
                      all.map((x, j) => (j === i ? { ...x, percent: v } : x)),
                    );
                  }}
                  className="w-28 rounded-md border border-border bg-surface px-2 py-1.5"
                />
              </label>
              <Button
                variant="quiet"
                onClick={() => setTiers((all) => all.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            className="justify-self-start"
            onClick={() =>
              setTiers((all) => [...all, { minQuantity: '10', percent: '5' }])
            }
          >
            Add a discount
          </Button>
        </Panel>
        <div className="flex items-center gap-3">
          <Button
            type="submit"
            disabled={fetcher.state !== 'idle'}
            className="px-6 py-2.5"
          >
            Save pricing
          </Button>
          <SaveStatus state={fetcher.state} result={fetcher.data} />
        </div>
      </fetcher.Form>
    </>
  );
}
