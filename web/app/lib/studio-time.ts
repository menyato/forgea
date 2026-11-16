/**
 * The studio's clock. The studio is in Lebanon, so the dashboard shows and takes times in
 * Beirut time (UTC+2, +3 in summer); the API keeps UTC. A fixed zone also keeps server and
 * browser output identical.
 */
export const STUDIO_TIME_ZONE = 'Asia/Beirut';

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: STUDIO_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** The studio's wall clock at `at`, as if it were UTC (so its fields read straight off). */
function wall(at: Date): Date {
  const p = Object.fromEntries(
    parts.formatToParts(at).map((x) => [x.type, x.value]),
  );
  return new Date(
    Date.UTC(
      Number(p['year']),
      Number(p['month']) - 1,
      Number(p['day']),
      Number(p['hour']),
      Number(p['minute']),
      Number(p['second']),
    ),
  );
}

/** "2026-11-02T06:00:00.000Z" → "2026-11-02T08:00", the value a datetime-local input shows. */
export const studioInput = (iso: string) =>
  wall(new Date(iso)).toISOString().slice(0, 16);

/** The studio's calendar day ("2026-11-02") at `iso`. */
export const studioDay = (iso: string) =>
  wall(new Date(iso)).toISOString().slice(0, 10);

/** Today in the studio ("2026-11-02"): date fields' default and limit, overdue marks. */
export const studioToday = () => studioDay(new Date().toISOString());

/**
 * A studio wall time ("2026-11-02T08:00", or a day "2026-11-02" for its midnight) as the
 * API's ISO timestamp. Something unreadable passes through unchanged so the DTO refuses it.
 */
export function fromStudioInput(value: string): string {
  const asUtc = new Date(`${value.length === 10 ? `${value}T00:00` : value}Z`);
  if (Number.isNaN(asUtc.getTime())) return value;
  // The offset at the guess, then at the corrected instant (right across a clock change).
  const offset = (at: Date) => wall(at).getTime() - at.getTime();
  const first = new Date(asUtc.getTime() - offset(asUtc));
  return new Date(asUtc.getTime() - offset(first)).toISOString();
}

/** Dates and times as the studio reads them. */
export const studioFormat = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { ...options, timeZone: STUDIO_TIME_ZONE });

const dayAndTime = studioFormat({ dateStyle: 'short', timeStyle: 'medium' });
const dayOnly = studioFormat({ dateStyle: 'short' });

/** "16/11/2026, 09:53:30" in the studio's time: the same on the server and in any browser. */
export const studioDateTime = (iso: string) => dayAndTime.format(new Date(iso));

/** "16/11/2026", the studio's day at `iso`. */
export const studioDate = (iso: string) => dayOnly.format(new Date(iso));
