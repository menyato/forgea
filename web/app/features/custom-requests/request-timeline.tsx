import {
  CUSTOM_REQUEST_STATUS_LABELS,
  type CustomRequestView,
} from '@forgea/types';

/** Every step of a request, oldest first, with the note left at each. */
export function RequestTimeline({
  history,
}: {
  history: CustomRequestView['history'];
}) {
  return (
    <ol className="grid gap-3 border-l border-border pl-4 text-sm">
      {history.map((h) => (
        <li key={h.changedAt + h.status} className="grid gap-0.5">
          <span className="font-semibold">
            {CUSTOM_REQUEST_STATUS_LABELS[h.status].title}
          </span>
          <time dateTime={h.changedAt} className="text-text-muted">
            {new Date(h.changedAt).toLocaleString('en-GB', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Asia/Beirut',
            })}
          </time>
          {h.note && <span>{h.note}</span>}
        </li>
      ))}
    </ol>
  );
}
