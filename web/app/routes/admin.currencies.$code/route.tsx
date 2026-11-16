import type { CurrencyQuote, ExchangeRateEntry } from '@forgea/types';
import { SetExchangeRateDto } from '@forgea/validation';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { useCan } from '~/features/admin/access';
import {
  AdminHeader,
  Panel,
  SaveStatus,
  ViewOnly,
} from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { apiContext } from '~/lib/request.server';
import { studioDateTime } from '~/lib/studio-time';
import type { Route } from './+types/route';

export async function loader({ params, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const code = params.code.toUpperCase();
  const [currencies, history] = await Promise.all([
    api.get<CurrencyQuote[]>('/currencies'),
    api.get<ExchangeRateEntry[]>(
      `/currencies/${encodeURIComponent(code)}/rates`,
    ),
  ]);
  if (!currencies.ok)
    throw new Response(currencies.message, { status: currencies.status });
  const currency = currencies.data.find((c) => c.code === code && !c.isBase);
  if (!currency) throw new Response('No such currency', { status: 404 });
  return { currency, history: history.ok ? history.data : [] };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const form = await request.formData();
  return save(SetExchangeRateDto, { rate: text(form, 'rate') }, (dto) =>
    context
      .get(apiContext)
      .put(
        `/currencies/${encodeURIComponent(params.code.toUpperCase())}/rate`,
        dto,
      ),
  );
}

export default function Currency({ loaderData }: Route.ComponentProps) {
  const { currency: c, history } = loaderData;
  const fetcher = useFetcher<SaveResult>();
  return (
    <>
      <AdminHeader
        title={`${c.name} (${c.code})`}
        intro="A new rate applies from now on; every order and invoice keeps the rate it was made at."
        trail={[{ label: 'Exchange rates', to: '/admin/currencies' }]}
      />
      <div className="grid gap-6">
        <ViewOnly editable={useCan()('currencies.manage')}>
          <Panel title={`Rate: ${c.name} (${c.code})`}>
            <p>
              Now:{' '}
              <strong>
                1 USD = {Number(c.rate).toLocaleString('en-US')} {c.code}
              </strong>
              {c.rateEffectiveFrom && (
                <span className="text-sm text-text-muted">
                  {' '}
                  since {studioDateTime(c.rateEffectiveFrom)}
                </span>
              )}
            </p>
            <fetcher.Form
              method="post"
              key={c.rate}
              className="flex flex-wrap items-end gap-3"
            >
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
          </Panel>
        </ViewOnly>
        <Panel title="Rate history">
          {history.length === 0 ? (
            <p className="text-text-muted">No rates set yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-text-muted">
                  <tr>
                    <th className="pr-6 font-medium">From</th>
                    <th className="pr-6 text-right font-medium">Rate</th>
                    <th className="font-medium">Set by</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr
                      key={h.effectiveFrom}
                      className="border-t border-border"
                    >
                      <td className="py-1.5 pr-6">
                        {studioDateTime(h.effectiveFrom)}
                      </td>
                      <td className="py-1.5 pr-6 text-right tabular-nums">
                        {Number(h.rate).toLocaleString('en-US')}
                      </td>
                      <td className="py-1.5">{h.setBy ?? 'Initial rate'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
