import type {
  AgedReceivables,
  BalanceSheet,
  ProfitAndLoss,
  ReportLine,
} from '@forgea/types';
import { Form, useSearchParams } from 'react-router';
import { Money } from '~/components/money';
import { buttonClass } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { AdminHeader, Panel } from '~/features/admin/admin-ui';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const today = new Date().toISOString().slice(0, 10);
  const from = url.searchParams.get('from') ?? `${today.slice(0, 4)}-01-01`;
  const to = url.searchParams.get('to') ?? today;
  const period = new URLSearchParams({ from, to });
  const [pnl, bs, aged] = await Promise.all([
    api.get<ProfitAndLoss>(`/accounting/reports/profit-and-loss?${period}`),
    api.get<BalanceSheet>(`/accounting/reports/balance-sheet?to=${to}`),
    api.get<AgedReceivables>(`/accounting/reports/aged-receivables?to=${to}`),
  ]);
  for (const r of [pnl, bs, aged])
    if (!r.ok) throw new Response(r.message, { status: r.status });
  return {
    from,
    to,
    pnl: pnl.ok ? pnl.data : null,
    bs: bs.ok ? bs.data : null,
    aged: aged.ok ? aged.data : null,
  };
}

function Lines({ lines }: { lines: ReportLine[] }) {
  return (
    <>
      {lines.map((l) => (
        <div
          key={l.code + l.name}
          className="flex justify-between gap-4 text-sm"
        >
          <span>
            {l.code && (
              <span className="mr-2 font-mono text-text-muted">{l.code}</span>
            )}
            {l.name}
          </span>
          <Money amount={l.amount} />
        </div>
      ))}
    </>
  );
}

function Total({ label, amount }: { label: string; amount: string }) {
  return (
    <div className="flex justify-between border-t border-border pt-2 font-semibold">
      <span>{label}</span>
      <Money amount={amount} />
    </div>
  );
}

export default function Reports({ loaderData }: Route.ComponentProps) {
  const { from, to, pnl, bs, aged } = loaderData;
  const [params] = useSearchParams();
  return (
    <>
      <AdminHeader
        trail={[{ label: 'Invoices', to: '/admin/accounting' }]}
        title="Reports"
        intro="From posted entries only, in US dollars. The balance sheet always balances: assets = liabilities + equity."
      />
      <Form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <Field
          label="From"
          name="from"
          type="date"
          defaultValue={params.get('from') ?? from}
        />
        <Field
          label="To"
          name="to"
          type="date"
          defaultValue={params.get('to') ?? to}
        />
        <button type="submit" className={buttonClass('secondary')}>
          Show
        </button>
      </Form>
      <div className="grid gap-6 lg:grid-cols-2">
        {pnl && (
          <Panel title={`Profit and loss, ${pnl.from} to ${pnl.to}`}>
            <p className="text-sm font-semibold">Income</p>
            <Lines lines={pnl.income} />
            <Total label="Total income" amount={pnl.totalIncome} />
            <p className="mt-2 text-sm font-semibold">Expenses</p>
            <Lines lines={pnl.expenses} />
            <Total label="Total expenses" amount={pnl.totalExpenses} />
            <Total label="Net profit" amount={pnl.netProfit} />
          </Panel>
        )}
        {bs && (
          <Panel title={`Balance sheet at ${bs.asOf}`}>
            <p className="text-sm font-semibold">Assets</p>
            <Lines lines={bs.assets} />
            <Total label="Total assets" amount={bs.totalAssets} />
            <p className="mt-2 text-sm font-semibold">Liabilities</p>
            <Lines lines={bs.liabilities} />
            <p className="mt-2 text-sm font-semibold">Equity</p>
            <Lines lines={bs.equity} />
            <Total
              label="Liabilities and equity"
              amount={bs.totalLiabilitiesAndEquity}
            />
          </Panel>
        )}
      </div>
      {aged && (
        <Panel title={`Who owes what, at ${aged.asOf}`} className="mt-6">
          {aged.rows.length === 0 ? (
            <p className="text-sm text-text-muted">Nobody owes anything.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-text-muted">
                  <tr>
                    {[
                      'Customer',
                      'Not due',
                      '1–30 days',
                      '31–60',
                      '61–90',
                      'Older',
                      'Total',
                    ].map((h) => (
                      <th key={h} className="py-2 pr-4 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {aged.rows.map((r) => (
                    <tr key={r.customer.id} className="border-t border-border">
                      <td className="py-2 pr-4">
                        {r.customer.name ?? r.customer.email}
                      </td>
                      {[
                        r.notDue,
                        r.days1to30,
                        r.days31to60,
                        r.days61to90,
                        r.older,
                        r.total,
                      ].map((v, i) => (
                        <td key={i} className="py-2 pr-4">
                          <Money amount={v} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </>
  );
}
