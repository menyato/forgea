import type { CurrencyQuote } from '@forgea/types';
import { AddCurrencyDto } from '@forgea/validation';
import { redirect, useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** A currency customers may also pay in, with its first rate; opens its page. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  let added: string | undefined;
  const result = await save(
    AddCurrencyDto,
    {
      code: text(form, 'code'),
      name: text(form, 'name'),
      decimals: text(form, 'decimals'),
      roundingStep: text(form, 'roundingStep'),
      rate: text(form, 'rate'),
    },
    async (dto) => {
      const r = await context
        .get(apiContext)
        .post<CurrencyQuote>('/currencies', dto);
      if (r.ok) added = r.data.code;
      return r;
    },
  );
  if (added) throw redirect(`/admin/currencies/${encodeURIComponent(added)}`);
  return result;
}

export default function NewCurrency() {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <>
      <AdminHeader
        title="New currency"
        intro="Prices stay in US dollars; customers can also pay in this currency, at the rate you set here (and change later on its page)."
        trail={[{ label: 'Exchange rates', to: '/admin/currencies' }]}
      />
      <Panel>
        <fetcher.Form method="post" className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Code"
            name="code"
            required
            maxLength={3}
            autoComplete="off"
            hint="Its three letters, e.g. EUR"
            error={errors['code']}
          />
          <Field
            label="Name"
            name="name"
            required
            autoComplete="off"
            hint="As customers read it, e.g. Euro"
            error={errors['name']}
          />
          <Field
            label="Rate: how many for 1 US dollar"
            name="rate"
            required
            inputMode="decimal"
            autoComplete="off"
            error={errors['rate']}
          />
          <Field
            label="Decimal places"
            name="decimals"
            required
            inputMode="numeric"
            defaultValue="2"
            autoComplete="off"
            hint="2 for euros, 0 for Lebanese pounds"
            error={errors['decimals']}
          />
          <Field
            label="Smallest cash amount"
            name="roundingStep"
            required
            inputMode="decimal"
            defaultValue="0.01"
            autoComplete="off"
            hint="Prices round to it: 0.01, or 5000 for Lebanese pounds"
            error={errors['roundingStep']}
          />
          <div className="flex items-end gap-3">
            <Button type="submit" disabled={fetcher.state !== 'idle'}>
              Add the currency
            </Button>
            <SaveStatus state={fetcher.state} result={fetcher.data} />
          </div>
        </fetcher.Form>
      </Panel>
    </>
  );
}
