/**
 * The studio's calendar: it is in Lebanon, so "today" (invoice dates, quotation expiry, the
 * year in a number) is Beirut's day, whatever the server's clock zone. Timestamps stay UTC.
 */
const STUDIO_TIME_ZONE = 'Asia/Beirut';

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: STUDIO_TIME_ZONE });

/** "2026-11-06": the studio's day at `now`. */
export const studioDay = (now = new Date()): string => DAY.format(now);

/** The studio's day as a date column's value (midnight UTC of that day). */
export const studioToday = (now = new Date()): Date =>
  new Date(`${studioDay(now)}T00:00:00Z`);

/** The studio's year (in order, quotation and invoice numbers). */
export const studioYear = (now = new Date()): number =>
  Number(studioDay(now).slice(0, 4));

const CLOCK = new Intl.DateTimeFormat('en-CA', {
  timeZone: STUDIO_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** How far the studio's clock is ahead of UTC at `at`, in milliseconds (summer time included). */
function studioOffsetMs(at: Date): number {
  const part = Object.fromEntries(
    CLOCK.formatToParts(at).map((p) => [p.type, p.value]),
  );
  const wall = Date.parse(
    `${part['year']}-${part['month']}-${part['day']}T${part['hour']}:${part['minute']}:${part['second']}Z`,
  );
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The moment a studio day ("2026-11-10") starts: Beirut's midnight, as a timestamp. Reports
 * count timestamps (orders, stock movements) by these days, the same days documents are dated.
 */
export function studioDayStart(day: string): Date {
  const utcMidnight = new Date(`${day}T00:00:00Z`);
  // The offset at that instant, then again at the result: right across a clock change too.
  const first = new Date(utcMidnight.getTime() - studioOffsetMs(utcMidnight));
  return new Date(utcMidnight.getTime() - studioOffsetMs(first));
}

/** The studio day `days` after (or, negative, before) `day`. */
export function studioDayPlus(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
