/**
 * The studio's calendar: it is in Lebanon, so "today" (invoice dates, quotation expiry, the
 * year in a number) is Beirut's day, whatever the server's clock zone. Timestamps stay UTC.
 */
export const STUDIO_TIME_ZONE = 'Asia/Beirut';

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: STUDIO_TIME_ZONE });

/** "2026-11-06": the studio's day at `now`. */
export const studioDay = (now = new Date()): string => DAY.format(now);

/** The studio's day as a date column's value (midnight UTC of that day). */
export const studioToday = (now = new Date()): Date =>
  new Date(`${studioDay(now)}T00:00:00Z`);

/** The studio's year (in order, quotation and invoice numbers). */
export const studioYear = (now = new Date()): number =>
  Number(studioDay(now).slice(0, 4));
