import type { ProductionResults } from '@forgea/types';
import { Link } from 'react-router';
import { Money } from '~/components/money';
import { AdminHeader, Panel } from '~/features/admin/admin-ui';
import { formatRange, PeriodPicker } from '~/features/admin/period-picker';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const query = new URLSearchParams();
  for (const key of ['from', 'to']) {
    const value = url.searchParams.get(key);
    if (value) query.set(key, value);
  }
  let error: string | null = null;
  let r = await api.get<ProductionResults>(
    `/print-jobs/results${query.size ? `?${query}` : ''}`,
  );
  if (!r.ok && r.status === 400 && query.size) {
    // A period the API refuses: say why and show the default one.
    error = r.message;
    r = await api.get<ProductionResults>('/print-jobs/results');
  }
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return {
    results: r.data,
    error,
    today: new Date().toISOString().slice(0, 10),
  };
}

function Figure({
  label,
  children,
  bad = false,
}: {
  label: string;
  children: React.ReactNode;
  bad?: boolean;
}) {
  return (
    <div className="grid gap-1 rounded-lg border border-border bg-surface p-4">
      <span className="text-sm text-text-muted">{label}</span>
      <span
        className={`text-2xl font-semibold tabular-nums ${bad ? 'text-danger' : ''}`}
      >
        {children}
      </span>
    </div>
  );
}

export default function Results({ loaderData }: Route.ComponentProps) {
  const { results: r, error, today } = loaderData;
  const lost = Number(r.cost.lost) > 0;
  return (
    <>
      <AdminHeader
        title="Production results"
        intro={`What the printers made and what was lost, ${formatRange(r.range)}, by when each run finished; and what waits on the shelf now.`}
        trail={[{ label: 'Production', to: '/admin/production' }]}
      />
      <PeriodPicker range={r.range} today={today} />
      {error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Figure label="Good pieces">{r.pieces.good}</Figure>
        <Figure label="Pieces lost" bad={r.pieces.lost > 0}>
          {r.pieces.lost}
        </Figure>
        <Figure label="Cost of good pieces">
          <Money amount={r.cost.good} />
        </Figure>
        <Figure label="Lost to failures" bad={lost}>
          <Money amount={r.cost.lost} />
        </Figure>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Print runs">
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2 text-sm">
            <dt className="text-text-muted">Done</dt>
            <dd className="text-right tabular-nums">{r.runs.done}</dd>
            <dt className="text-text-muted">Failed</dt>
            <dd className="text-right tabular-nums">{r.runs.failed}</dd>
            <dt className="text-text-muted">Cancelled before printing</dt>
            <dd className="text-right tabular-nums">{r.runs.cancelled}</dd>
            <dt className="text-text-muted">Spare pieces (to the shelf)</dt>
            <dd className="text-right tabular-nums">{r.pieces.spare}</dd>
            <dt className="text-text-muted">Filament used</dt>
            <dd className="text-right tabular-nums">{r.grams.used} g</dd>
            <dt className="text-text-muted">of which lost</dt>
            <dd className="text-right tabular-nums">{r.grams.lost} g</dd>
            <dt className="text-text-muted">Printing hours</dt>
            <dd className="text-right tabular-nums">{r.hours.printing} h</dd>
            <dt className="text-text-muted">of which lost</dt>
            <dd className="text-right tabular-nums">{r.hours.lost} h</dd>
            <dt className="text-text-muted">Electricity</dt>
            <dd className="text-right tabular-nums">{r.electricityKwh} kWh</dd>
            {r.studioFailures.grams > 0 && (
              <>
                <dt className="text-text-muted">
                  Failed studio prints (in the lost cost)
                </dt>
                <dd className="text-right tabular-nums">
                  {r.studioFailures.grams} g ·{' '}
                  <Money amount={r.studioFailures.cost} />
                </dd>
              </>
            )}
          </dl>
        </Panel>
        <Panel title="Ready pieces">
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2 text-sm">
            <dt className="text-text-muted">On the shelf now</dt>
            <dd className="text-right tabular-nums">{r.shelf.pieces}</dd>
            <dt className="text-text-muted">Worth, at cost</dt>
            <dd className="text-right tabular-nums">
              <Money amount={r.shelf.value} />
            </dd>
            <dt className="text-text-muted">Added in the period</dt>
            <dd className="text-right tabular-nums">{r.shelf.added}</dd>
            <dt className="text-text-muted">Sold in the period</dt>
            <dd className="text-right tabular-nums">{r.shelf.sold}</dd>
            <dt className="text-text-muted">Given away or scrapped</dt>
            <dd className="text-right tabular-nums">
              {r.shelf.usedOrScrapped}
            </dd>
            <dt className="text-text-muted">Scrapped, at cost</dt>
            <dd className="text-right tabular-nums">
              <Money amount={r.shelf.scrappedCost} />
            </dd>
          </dl>
          <Link to="/admin/stock/pieces" className="text-sm underline">
            Open the ready pieces
          </Link>
        </Panel>
      </div>
      <Panel title="By printer" className="mt-6">
        {r.printers.length === 0 ? (
          <p className="text-sm text-text-muted">
            No run finished in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table aria-label="By printer" className="w-full text-sm">
              <thead className="text-left text-text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Printer
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    Runs
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    Failed
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    Hours
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    kWh
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Lost
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.printers.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="py-2 pr-4">
                      <Link
                        to={`/admin/printers/${p.id}`}
                        className="underline"
                      >
                        {p.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {p.runs}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {p.failed}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {p.hours}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {p.kwh}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      <Money amount={p.lostCost} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
