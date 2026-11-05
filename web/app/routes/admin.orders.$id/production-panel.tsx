import {
  type Money as MoneyValue,
  PRINT_JOB_STATUS_LABELS,
  PrintJobStatus,
  type PrintJobListItem,
} from '@forgea/types';
import { Link } from 'react-router';
import { Money } from '~/components/money';
import { Panel } from '~/features/admin/admin-ui';

const cents = (v: string) => Math.round(Number(v) * 100);

/**
 * The order's print jobs and what they really cost against what the customer pays. Staff
 * only: customers never see grams, hours or costs.
 */
export function ProductionPanel({
  jobs,
  orderId,
  total,
}: {
  jobs: PrintJobListItem[];
  orderId: string;
  total: MoneyValue;
}) {
  const costed = jobs.filter((j) => j.cost);
  const spent = costed.reduce((sum, j) => sum + cents(j.cost!.total), 0);
  const open = jobs.filter(
    (j) =>
      j.status !== PrintJobStatus.DONE &&
      j.status !== PrintJobStatus.FAILED &&
      j.status !== PrintJobStatus.CANCELLED,
  ).length;
  const left = cents(total) - spent;
  return (
    <Panel title="Production">
      {jobs.length === 0 ? (
        <p className="text-sm text-text-muted">
          No print jobs yet: they are planned when the order goes into
          production.
        </p>
      ) : (
        <ul className="grid gap-2 text-sm">
          {jobs.map((j) => (
            <li
              key={j.id}
              className="flex flex-wrap items-baseline justify-between gap-2"
            >
              <Link
                to={`/admin/production/${j.id}`}
                className="underline underline-offset-4"
              >
                {j.quantity} × {j.item?.name ?? 'Other work'}
              </Link>
              <span className="text-text-muted">
                {PRINT_JOB_STATUS_LABELS[j.status]} ·{' '}
                {j.printer?.name ?? 'no printer'} ·{' '}
                {j.reel ? `${j.reel.material} ${j.reel.colour}` : 'no reel'} ·{' '}
                {j.actualGrams ?? j.grams} g
                {j.cost ? (
                  <>
                    {' '}
                    · <Money amount={j.cost.total} />
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        <dt>Customer pays</dt>
        <dd className="text-right">
          <Money amount={total} />
        </dd>
        <dt>Print costs so far (filament, electricity, wear)</dt>
        <dd className="text-right">
          <Money amount={(spent / 100).toFixed(2)} />
        </dd>
        <dt className="font-medium">Left after print costs</dt>
        <dd className="text-right font-medium">
          <Money amount={(left / 100).toFixed(2)} />
        </dd>
      </dl>
      {open > 0 && (
        <p className="mt-2 text-xs text-text-muted">
          {open} job{open === 1 ? '' : 's'} not finished yet: the cost grows as
          they finish.
        </p>
      )}
      <Link
        to={`/admin/production/new?order=${orderId}`}
        className="mt-3 inline-block text-sm underline underline-offset-4"
      >
        Plan another print for this order
      </Link>
    </Panel>
  );
}
