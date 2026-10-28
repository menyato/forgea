import type { CurrencyQuote, ExchangeRateEntry } from '@forgea/types';
import { SetExchangeRateDto } from '@forgea/validation';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const currencies = await api.get<CurrencyQuote[]>('/currencies');
  if (!currencies.ok)
    throw new Response(currencies.message, { status: currencies.status });
  const others = currencies.data.filter((c) => !c.isBase);
  const histories = await Promise.all(
    others.map((c) =>
      api.get<ExchangeRateEntry[]>(`/currencies/${c.code}/rates`),
    ),
  );
  return {
    currencies: others.map((c, i) => ({
      ...c,
      history: histories[i]?.ok ? histories[i].data : [],
    })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const code = text(form, 'code') ?? '';
  return save(SetExchangeRateDto, { rate: text(form, 'rate') }, (dto) =>
    context
      .get(apiContext)
      .put(`/currencies/${encodeURIComponent(code)}/rate`, dto),
  );
}

export default function Currencies({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <AdminHeader
        title="Exchange rates"
        intro="Prices are set in US dollars. Customers can also pay in these currencies at the rate you set here. A new rate applies from now on; every order keeps the rate it was placed at."
      />
      <div className="grid gap-6">
        {loaderData.currencies.map((c) => (
          <RateForm key={c.code} currency={c} />
        ))}
      </div>
    </>
  );
}

function RateForm({
  currency: c,
}: {
  currency: CurrencyQuote & { history: ExchangeRateEntry[] };
}) {
  const fetcher = useFetcher<SaveResult>();
  return (
    <Panel title={`${c.name} (${c.code})`}>
      <p>
        Now:{' '}
        <strong>
          1 USD = {Number(c.rate).toLocaleString('en-US')} {c.code}
        </strong>
        {c.rateEffectiveFrom && (
          <span className="text-sm text-text-muted">
            {' '}
            since {new Date(c.rateEffectiveFrom).toLocaleString('en-GB')}
          </span>
        )}
      </p>
      <fetcher.Form method="post" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="code" value={c.code} />
        <Field
          label={`New rate (${c.code} per 1 USD)`}
          name="rate"
          inputMode="decimal"
          required
          error={fetcher.data?.errors?.['rate']}
        />
        <Button type="submit" disabled={fetcher.state !== 'idle'}>
          Set the rate
        </Button>
        <SaveStatus state={fetcher.state} result={fetcher.data} />
      </fetcher.Form>
      {c.history.length > 0 && (
        <table className="text-sm">
          <thead className="text-left text-text-muted">
            <tr>
              <th className="pr-6 font-medium">From</th>
              <th className="pr-6 font-medium">Rate</th>
              <th className="font-medium">Set by</th>
            </tr>
          </thead>
          <tbody>
            {c.history.map((h) => (
              <tr key={h.effectiveFrom}>
                <td className="pr-6">
                  {new Date(h.effectiveFrom).toLocaleString('en-GB')}
                </td>
                <td className="pr-6 tabular-nums">
                  {Number(h.rate).toLocaleString('en-US')}
                </td>
                <td>{h.setBy ?? 'Initial rate'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
