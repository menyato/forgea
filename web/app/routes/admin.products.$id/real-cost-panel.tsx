import type { ProductRealCost } from '@forgea/types';
import { Money } from '~/components/money';

/**
 * What one piece really took and cost, from the product's finished print runs (failed
 * reprints included), next to the grams and hours the product is priced with. Dashboard only.
 */
export function RealCostPanel({
  cost,
  grams,
  hours,
}: {
  cost: ProductRealCost;
  /** What the product is priced with, for comparison. */
  grams: string;
  hours: string;
}) {
  const p = cost.perPiece;
  const runs = `${cost.done} print run${cost.done === 1 ? '' : 's'} done${
    cost.failed ? `, ${cost.failed} failed` : ''
  }, ${cost.pieces} piece${cost.pieces === 1 ? '' : 's'}`;
  if (!p)
    return (
      <p className="text-sm text-text-muted">
        No finished print run yet: the real cost shows once one is marked done
        with what it took.
      </p>
    );
  const margin = Number(p.margin);
  return (
    <div className="grid gap-2 text-sm">
      <p className="text-text-muted">From {runs}. Per piece:</p>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
        <dt className="text-text-muted">Filament used</dt>
        <dd className="text-right tabular-nums">
          {p.grams} g{' '}
          <span className="text-text-muted">(priced with {grams} g)</span>
        </dd>
        <dt className="text-text-muted">Print time</dt>
        <dd className="text-right tabular-nums">
          {p.hours} h{' '}
          <span className="text-text-muted">(priced with {hours} h)</span>
        </dd>
        {(
          [
            ['Filament', p.material],
            ['Electricity', p.electricity],
            ['Printer wear', p.wear],
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
          Real print cost
        </dt>
        <dd className="border-t border-border pt-1 text-right font-medium tabular-nums">
          <Money amount={p.total} />
        </dd>
        <dt className="text-text-muted">Customers paid, on average</dt>
        <dd className="text-right tabular-nums">
          <Money amount={p.soldAt} />
        </dd>
        <dt className="font-medium">Left after print costs</dt>
        <dd
          className={`text-right font-medium tabular-nums ${margin < 0 ? 'text-danger' : ''}`}
        >
          <Money amount={p.margin} />
        </dd>
      </dl>
      <p className="text-xs text-text-muted">
        Labour and packaging aren't in the real cost; the estimate above has
        them.
      </p>
    </div>
  );
}
