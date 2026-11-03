import { ORDER_STATUS_LABELS, type OrderHistoryEntry } from '@forgea/types';
import { STUDIO_TIME_ZONE } from '~/lib/studio-time';

// The studio is in Lebanon; a fixed time zone also keeps server and browser output identical.
const when = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: STUDIO_TIME_ZONE,
});

/** Every status the order has been through, oldest first, the current one emphasised. */
export function OrderTimeline({
  history,
}: {
  history: readonly OrderHistoryEntry[];
}) {
  return (
    <ol className="grid gap-3 border-l-2 border-border pl-5">
      {history.map((entry, i) => {
        const current = i === history.length - 1;
        const label = ORDER_STATUS_LABELS[entry.status];
        return (
          <li key={`${entry.status}-${entry.changedAt}`} className="relative">
            <span
              aria-hidden="true"
              className={`absolute -left-[1.6rem] top-1.5 size-3 rounded-full ${current ? 'bg-accent' : 'bg-border'}`}
            />
            <p className={current ? 'font-semibold' : 'text-text-muted'}>
              {label.title}
              {current && <span className="sr-only"> (current status)</span>}
            </p>
            <p className="text-xs text-text-muted">
              <time dateTime={entry.changedAt}>
                {when.format(new Date(entry.changedAt))}
              </time>
            </p>
            {current && <p className="text-sm">{label.detail}</p>}
            {entry.note && <p className="mt-1 text-sm">“{entry.note}”</p>}
          </li>
        );
      })}
    </ol>
  );
}
