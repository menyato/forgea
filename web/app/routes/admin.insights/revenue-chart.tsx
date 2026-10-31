import type { InsightsGranularity, InsightsSeriesPoint } from '@forgea/types';
import { useId } from 'react';
import { Money } from '~/components/money';
import { formatDay } from '~/features/admin/period-picker';

const BAR = 10;
const GAP = 4;
const HEIGHT = 160;

const MONTH = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** A bar's name: the day, "week of 5 Oct 2026", or "Oct 2026". */
function barLabel(start: string, granularity: InsightsGranularity) {
  if (granularity === 'month')
    return MONTH.format(new Date(`${start}T00:00:00Z`));
  if (granularity === 'week') return `Week of ${formatDay(start)}`;
  return formatDay(start);
}

/**
 * Revenue (a pale bar) with the gross profit in it (solid; below the line when a bar lost
 * money), one pair per day, week or month. Drawn as inline SVG in the brand's colours; the
 * same numbers are in a table underneath for anyone who can't see the chart.
 */
export function RevenueChart({
  series,
  granularity,
}: {
  series: InsightsSeriesPoint[];
  granularity: InsightsGranularity;
}) {
  const id = useId();
  const values = series.flatMap((p) => [
    Number(p.revenue),
    Number(p.grossProfit),
  ]);
  const top = Math.max(...values, 0);
  const bottom = Math.min(...values, 0);
  const span = top - bottom || 1;
  const y = (v: number) => ((top - v) / span) * HEIGHT;
  const width = series.length * (BAR + GAP);
  const empty = values.every((v) => v === 0);
  return (
    <figure className="grid gap-3">
      <div className="flex flex-wrap gap-4 text-sm" aria-hidden="true">
        <span className="flex items-center gap-2">
          <span className="inline-block size-3 rounded-sm bg-accent/35" />{' '}
          Revenue
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block size-3 rounded-sm bg-success" /> Gross
          profit (estimated)
        </span>
      </div>
      {empty ? (
        <p className="text-sm text-text-muted">
          No sales in the books for this period yet.
        </p>
      ) : (
        <svg
          role="img"
          aria-labelledby={`${id}-title`}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="h-40 w-full"
        >
          {/* One string: React renders a <title> with several text pieces differently on the server. */}
          <title id={`${id}-title`}>
            {`Revenue and estimated gross profit by ${granularity}; the values are in the table below.`}
          </title>
          <line
            x1={0}
            x2={width}
            y1={y(0)}
            y2={y(0)}
            className="stroke-border"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {series.map((p, i) => {
            const x = i * (BAR + GAP) + GAP / 2;
            const revenue = Number(p.revenue);
            const profit = Number(p.grossProfit);
            return (
              <g key={p.start}>
                <title>
                  {`${barLabel(p.start, granularity)}: revenue ${p.revenue}, gross profit ${p.grossProfit}`}
                </title>
                <rect
                  x={x}
                  width={BAR}
                  y={Math.min(y(revenue), y(0))}
                  height={Math.abs(y(revenue) - y(0))}
                  className="fill-accent/35"
                />
                <rect
                  x={x + BAR * 0.25}
                  width={BAR * 0.5}
                  y={Math.min(y(profit), y(0))}
                  height={Math.abs(y(profit) - y(0))}
                  className={profit < 0 ? 'fill-danger' : 'fill-success'}
                />
              </g>
            );
          })}
        </svg>
      )}
      {series.length > 0 && !empty && (
        <div
          className="flex justify-between text-xs text-text-muted"
          aria-hidden="true"
        >
          <span>{barLabel(series[0]!.start, granularity)}</span>
          {series.length > 1 && (
            <span>
              {barLabel(series[series.length - 1]!.start, granularity)}
            </span>
          )}
        </div>
      )}
      <details>
        <summary className="cursor-pointer text-sm text-text-muted">
          Show the numbers
        </summary>
        <div className="mt-2 max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-text-muted">
              <tr>
                <th className="py-1 pr-4 font-medium">
                  {granularity === 'day'
                    ? 'Day'
                    : granularity === 'week'
                      ? 'Week'
                      : 'Month'}
                </th>
                <th className="py-1 pr-4 text-right font-medium">Revenue</th>
                <th className="py-1 pr-4 text-right font-medium">
                  Production cost
                </th>
                <th className="py-1 text-right font-medium">Gross profit</th>
              </tr>
            </thead>
            <tbody>
              {series.map((p) => (
                <tr key={p.start} className="border-t border-border">
                  <td className="py-1 pr-4 whitespace-nowrap">
                    {barLabel(p.start, granularity)}
                  </td>
                  <td className="py-1 pr-4 text-right">
                    <Money amount={p.revenue} />
                  </td>
                  <td className="py-1 pr-4 text-right">
                    <Money amount={p.productionCost} />
                  </td>
                  <td className="py-1 text-right">
                    <Money amount={p.grossProfit} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <figcaption className="text-xs text-text-muted">
        Revenue is from the books (taxes excluded); the profit takes off the
        estimated cost of making what was invoiced.
      </figcaption>
    </figure>
  );
}
