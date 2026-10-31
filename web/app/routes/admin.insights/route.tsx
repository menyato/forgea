import {
  type BusinessInsights,
  ORDER_STATUS_LABELS,
  type OrderStatus,
  OrderStatus as Status,
} from '@forgea/types';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Money } from '~/components/money';
import { FormAlert } from '~/components/ui/field';
import { AdminHeader, Panel } from '~/features/admin/admin-ui';
import { formatRange, PeriodPicker } from '~/features/admin/period-picker';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';
import { FigureTile } from './figure-tile';
import { RevenueChart } from './revenue-chart';

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const today = new Date().toISOString().slice(0, 10);
  const query = new URLSearchParams();
  for (const key of ['from', 'to']) {
    const value = url.searchParams.get(key);
    if (value) query.set(key, value);
  }
  const asked = query.size ? `?${query}` : '';
  let r = await api.get<BusinessInsights>(`/insights${asked}`);
  let error: string | null = null;
  // A period that makes no sense: say why, and show this month instead.
  if (!r.ok && r.status === 400 && asked) {
    error = r.message;
    r = await api.get<BusinessInsights>('/insights');
  }
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { insights: r.data, today, error };
}

const grams = (g: number) => `${g.toLocaleString('en-US')} g`;

export default function Business({ loaderData }: Route.ComponentProps) {
  const { insights: i, today, error } = loaderData;
  const now = i.current;
  const was = i.before;
  return (
    <>
      <AdminHeader
        title="Business"
        intro="How the studio is doing: what you sold, what it cost to make, what is left as profit, and what sells. Each figure is compared with the period of the same length just before."
      />
      <FormAlert message={error ?? undefined} />
      <PeriodPicker range={i.range} today={today} />
      <p className="mb-4 text-sm text-text-muted">
        {formatRange(i.range)}, compared with {formatRange(i.previous)}. Amounts
        in US dollars.
      </p>

      <section aria-labelledby="money" className="mb-8 grid gap-4">
        <h2 id="money" className="font-display text-xl font-bold">
          Money
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <FigureTile
            label="Revenue (taxes excluded)"
            value={<Money amount={now.revenue} />}
            current={now.revenue}
            previous={was.revenue}
            note={
              <>
                <Money amount={now.revenueWithTax} /> with taxes (
                <Money amount={now.tax} /> tax). What was delivered and
                invoiced, less credit notes.
              </>
            }
          />
          <FigureTile
            label="Production cost"
            estimated
            value={<Money amount={now.productionCost} />}
            current={now.productionCost}
            previous={was.productionCost}
            better="down"
            note={
              Number(now.uncostedRevenue) > 0 ? (
                <>
                  Filament, machine time, waste, labour and packaging at
                  today&apos;s pricing settings.{' '}
                  <Money amount={now.uncostedRevenue} /> of custom work has no
                  estimate.
                </>
              ) : (
                "Filament, machine time, waste, labour and packaging at today's pricing settings."
              )
            }
          />
          <FigureTile
            label="Gross profit"
            estimated
            value={<Money amount={now.grossProfit} />}
            current={now.grossProfit}
            previous={was.grossProfit}
            note={
              now.grossMarginPercent === null
                ? 'Revenue − production cost.'
                : `${now.grossMarginPercent}% of revenue is left after making it.`
            }
          />
          <FigureTile
            label="Net profit (books)"
            value={<Money amount={now.netProfit} />}
            current={now.netProfit}
            previous={was.netProfit}
            note={
              Number(now.expenses) === 0 ? (
                <>
                  No expenses recorded for this period, so this is all revenue.{' '}
                  <Link to="/admin/accounting/books" className="underline">
                    Record rent, filament bought and other costs
                  </Link>
                  .
                </>
              ) : (
                <>
                  Revenue − <Money amount={now.expenses} /> of expenses in the
                  books.
                </>
              )
            }
          />
          <FigureTile
            label="Expenses recorded"
            value={<Money amount={now.expenses} />}
            current={now.expenses}
            previous={was.expenses}
            better="down"
            note="Everything booked to expense accounts (see the list below)."
          />
          <FigureTile
            label="Cash collected"
            value={<Money amount={now.cashCollected} />}
            current={now.cashCollected}
            previous={was.cashCollected}
            note="Payments received: cash on delivery, transfers and deposits."
          />
          <FigureTile
            label="Still owed by customers"
            value={<Money amount={now.owed} />}
            current={now.owed}
            previous={was.owed}
            better="down"
            note={
              <>
                At the end of the period.{' '}
                <Link to="/admin/accounting?tab=unpaid" className="underline">
                  Unpaid invoices
                </Link>
              </>
            }
          />
          <FigureTile
            label="Orders"
            value={now.orders}
            current={now.orders}
            previous={was.orders}
            note={
              now.averageOrderValue === null ? (
                'Placed in the period, cancelled ones left out.'
              ) : (
                <>
                  <Money amount={now.averageOrderValue} /> on average (taxes and
                  delivery included), <Money amount={now.orderValue} /> in all.
                </>
              )
            }
          />
        </div>
      </section>

      <div className="mb-8 grid gap-6 lg:grid-cols-3">
        <Panel title="Revenue and profit" className="lg:col-span-2">
          <RevenueChart series={i.series} granularity={i.granularity} />
        </Panel>
        <Panel title="Expenses recorded">
          {i.expenses.length === 0 ? (
            <p className="text-sm text-text-muted">None in this period.</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {i.expenses.map((e) => (
                <li key={e.code} className="flex justify-between gap-4">
                  <span>{e.name}</span>
                  <Money amount={e.amount} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <section aria-labelledby="sellers" className="mb-8 grid gap-4">
        <h2 id="sellers" className="font-display text-xl font-bold">
          What sells
        </h2>
        <div className="grid gap-6 lg:grid-cols-3">
          <Panel title="Best sellers" className="lg:col-span-2">
            <p className="text-sm text-text-muted">
              Products delivered and invoiced in the period, by revenue (taxes
              excluded). The margin is what is left after the estimated
              production cost.
            </p>
            {i.products.length === 0 ? (
              <p className="text-sm text-text-muted">Nothing invoiced yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-text-muted">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Product</th>
                      <th className="py-2 pr-4 text-right font-medium">
                        Units
                      </th>
                      <th className="py-2 pr-4 text-right font-medium">
                        Revenue
                      </th>
                      <th className="py-2 pr-4 text-right font-medium">
                        Cost (est.)
                      </th>
                      <th className="py-2 text-right font-medium">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {i.products.map((p) => (
                      <tr key={p.productId} className="border-t border-border">
                        <td className="py-2 pr-4">
                          <Link
                            to={`/admin/products/${p.productId}`}
                            className="hover:underline"
                          >
                            {p.name}
                          </Link>
                          {p.category && (
                            <span className="block text-xs text-text-muted">
                              {p.category}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {p.units}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          <Money amount={p.revenue} />
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {p.productionCost ? (
                            <Money amount={p.productionCost} />
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {p.marginPercent === null
                            ? '—'
                            : `${p.marginPercent}%`}
                        </td>
                      </tr>
                    ))}
                    {i.customWork.units !== 0 && (
                      <tr className="border-t border-border text-text-muted">
                        <td className="py-2 pr-4">
                          Custom work and quotation lines
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {i.customWork.units}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          <Money amount={i.customWork.revenue} />
                        </td>
                        <td className="py-2 pr-4 text-right">—</td>
                        <td className="py-2 text-right">—</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <Panel title="By category">
            {i.categories.length === 0 ? (
              <p className="text-sm text-text-muted">Nothing invoiced yet.</p>
            ) : (
              <Bars
                rows={i.categories.map((c) => ({
                  key: c.name ?? '',
                  label: c.name ?? 'No category',
                  value: Number(c.revenue),
                  text: <Money amount={c.revenue} />,
                }))}
              />
            )}
          </Panel>
        </div>
        {i.options.length > 0 && (
          <Panel title="What customers choose">
            <p className="text-sm text-text-muted">
              Sizes, colours and other choices on the orders placed in the
              period (units).
            </p>
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {i.options.map((g) => (
                <div key={g.group} className="grid content-start gap-2">
                  <h3 className="text-sm font-semibold">{g.group}</h3>
                  <Bars
                    rows={g.values.map((v) => ({
                      key: v.value,
                      label: v.value,
                      value: v.units,
                      text: String(v.units),
                    }))}
                  />
                </div>
              ))}
            </div>
          </Panel>
        )}
      </section>

      <section aria-labelledby="funnel" className="mb-8 grid gap-4">
        <h2 id="funnel" className="font-display text-xl font-bold">
          Sales and customers
        </h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Orders placed">
            <Bars
              rows={Object.values(Status)
                .filter((s) => (i.orders.byStatus[s] ?? 0) > 0)
                .map((s: OrderStatus) => ({
                  key: s,
                  label: ORDER_STATUS_LABELS[s].title,
                  value: i.orders.byStatus[s] ?? 0,
                  text: String(i.orders.byStatus[s] ?? 0),
                }))}
              empty="No orders in this period."
            />
            <dl className="grid gap-1 text-sm">
              <Fact label="Cancelled">
                {i.orders.cancelled} of {i.orders.placed}
                {i.orders.cancellationPercent !== null &&
                  ` (${i.orders.cancellationPercent}%)`}
              </Fact>
            </dl>
          </Panel>
          <Panel title="Who orders, and how">
            <div className="grid gap-3">
              <Split
                label="Customers"
                a={{ label: 'New', value: i.orders.newCustomers }}
                b={{ label: 'Returning', value: i.orders.returningCustomers }}
              />
              <Split
                label="Getting it"
                a={{ label: 'Delivery', value: i.orders.delivery }}
                b={{ label: 'Pickup', value: i.orders.pickup }}
              />
              <Split
                label="Paying"
                a={{
                  label: 'Cash on delivery',
                  value: i.orders.cashOnDelivery,
                }}
                b={{ label: 'Transfer', value: i.orders.transfer }}
              />
              <Split
                label="Speed"
                a={{ label: 'Rush', value: i.orders.rush }}
                b={{ label: 'Normal', value: now.orders - i.orders.rush }}
              />
            </div>
          </Panel>
          <Panel title="Custom requests and quotations">
            <Funnel
              steps={[
                { label: 'Custom requests sent', value: i.requests.submitted },
                { label: 'Quoted', value: i.requests.quoted },
                {
                  label: 'Accepted (became orders)',
                  value: i.requests.accepted,
                },
              ]}
            />
            <Funnel
              steps={[
                { label: 'Quotations written', value: i.quotations.created },
                { label: 'Sent to the customer', value: i.quotations.sent },
                {
                  label: 'Confirmed (became orders)',
                  value: i.quotations.confirmed,
                },
              ]}
            />
          </Panel>
          <Panel title="Leads">
            <dl className="grid gap-1 text-sm">
              <Fact label="New leads">{i.leads.created}</Fact>
              <Fact label="Won">{i.leads.won}</Fact>
              <Fact label="Lost">{i.leads.lost}</Fact>
            </dl>
            {i.leads.lostReasons.length > 0 && (
              <>
                <h3 className="text-sm font-semibold">Why leads were lost</h3>
                <Bars
                  rows={i.leads.lostReasons.map((r) => ({
                    key: r.name,
                    label: r.name,
                    value: r.count,
                    text: String(r.count),
                  }))}
                />
              </>
            )}
          </Panel>
        </div>
      </section>

      <section aria-labelledby="filament" className="grid gap-4">
        <h2 id="filament" className="font-display text-xl font-bold">
          Filament
        </h2>
        <Panel>
          <p className="text-sm text-text-muted">
            Taken out of stock in the period (orders going into production and
            other use), lost to failed prints, and what is on the shelf now.{' '}
            <Link to="/admin/stock" className="underline">
              Stock and what to restock
            </Link>
          </p>
          {i.materials.length === 0 ? (
            <p className="text-sm text-text-muted">
              No filament used in this period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-text-muted">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Filament</th>
                    <th className="py-2 pr-4 text-right font-medium">Used</th>
                    <th className="py-2 pr-4 text-right font-medium">
                      Failed prints
                    </th>
                    <th className="py-2 pr-4 text-right font-medium">
                      On the shelf
                    </th>
                    <th className="py-2 font-medium">Restock</th>
                  </tr>
                </thead>
                <tbody>
                  {i.materials.map((m) => (
                    <tr
                      key={`${m.code}:${m.colour}`}
                      className="border-t border-border"
                    >
                      <td className="py-2 pr-4">
                        {m.code}{' '}
                        {m.colour || (
                          <span className="text-text-muted">(any colour)</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {grams(m.usedGrams)}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {grams(m.failedGrams)}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {grams(m.stockGrams)}
                      </td>
                      <td className="py-2">
                        {m.needsRestock ? (
                          <span className="font-semibold text-warning">
                            Restock now
                          </span>
                        ) : m.daysLeft !== null ? (
                          `About ${m.daysLeft} days left`
                        ) : (
                          'OK'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </section>
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-text-muted">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

/** Horizontal bars with their values written out: no chart needed to read them. */
function Bars({
  rows,
  empty = 'Nothing yet.',
}: {
  rows: { key: string; label: string; value: number; text: ReactNode }[];
  empty?: string;
}) {
  if (rows.length === 0)
    return <p className="text-sm text-text-muted">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="grid gap-2 text-sm">
      {rows.map((r) => (
        <li key={r.key} className="grid gap-1">
          <div className="flex justify-between gap-4">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="tabular-nums">{r.text}</span>
          </div>
          <div
            className="h-2 rounded-pill bg-surface-raised"
            aria-hidden="true"
          >
            <div
              className="h-2 rounded-pill bg-accent"
              style={{ width: `${Math.max((r.value / max) * 100, 0)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Two parts of a whole, e.g. new and returning customers. */
function Split({
  label,
  a,
  b,
}: {
  label: string;
  a: { label: string; value: number };
  b: { label: string; value: number };
}) {
  const total = a.value + b.value;
  const share = total ? Math.round((a.value / total) * 100) : 0;
  return (
    <div className="grid gap-1 text-sm">
      <div className="flex flex-wrap justify-between gap-x-4">
        <span className="font-medium">{label}</span>
        <span className="text-text-muted">
          {a.label} {a.value}
          {total ? ` (${share}%)` : ''} · {b.label} {b.value}
          {total ? ` (${100 - share}%)` : ''}
        </span>
      </div>
      <div
        className="flex h-2 overflow-hidden rounded-pill bg-surface-raised"
        aria-hidden="true"
      >
        <div className="h-2 bg-accent" style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}

/** Steps of a funnel, each with its share of the first. */
function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const first = steps[0]?.value ?? 0;
  return (
    <ol className="grid gap-1 text-sm">
      {steps.map((s, n) => (
        <li key={s.label} className="flex justify-between gap-4">
          <span>{s.label}</span>
          <span className="tabular-nums">
            {s.value}
            {n > 0 && first > 0 && (
              <span className="text-text-muted">
                {' '}
                ({Math.round((s.value / first) * 100)}%)
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
