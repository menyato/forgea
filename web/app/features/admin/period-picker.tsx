import {
  type DateRange,
  PERIOD_PRESET_LABELS,
  PERIOD_PRESETS,
  presetRange,
} from '@forgea/types';
import { Form, Link } from 'react-router';
import { buttonClass } from '~/components/ui/button';
import { Field } from '~/components/ui/field';

const DAY = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "1 Oct 2026", the same on the server and in the browser. */
export const formatDay = (day: string) =>
  DAY.format(new Date(`${day}T00:00:00Z`));

/** "1 Oct 2026 – 31 Oct 2026", or one day. */
export const formatRange = (r: DateRange) =>
  r.from === r.to
    ? formatDay(r.from)
    : `${formatDay(r.from)} – ${formatDay(r.to)}`;

/**
 * Choose a period: the usual ones as links (`?from=&to=`, so a period can be bookmarked and
 * works before JavaScript), or any two dates. Days are UTC days, like the books.
 */
export function PeriodPicker({
  range,
  today,
  presets = true,
}: {
  range: DateRange;
  today: string;
  presets?: boolean;
}) {
  return (
    <div className="mb-6 grid gap-3">
      {presets && (
        <nav aria-label="Period" className="flex flex-wrap gap-2">
          {PERIOD_PRESETS.map((p) => {
            const r = presetRange(p, today);
            const active = r.from === range.from && r.to === range.to;
            return (
              <Link
                key={p}
                to={`?from=${r.from}&to=${r.to}`}
                aria-current={active ? 'page' : undefined}
                className={`rounded-pill border px-3 py-1 text-sm ${
                  active
                    ? 'border-accent bg-accent text-on-accent'
                    : 'border-border bg-surface text-text hover:border-accent'
                }`}
              >
                {PERIOD_PRESET_LABELS[p]}
              </Link>
            );
          })}
        </nav>
      )}
      <Form
        // A new period shows its own dates in the boxes.
        key={`${range.from}:${range.to}`}
        method="get"
        className="flex flex-wrap items-end gap-3"
      >
        <Field label="From" name="from" type="date" defaultValue={range.from} />
        <Field label="To" name="to" type="date" defaultValue={range.to} />
        <button type="submit" className={buttonClass('secondary')}>
          Show
        </button>
      </Form>
    </div>
  );
}
