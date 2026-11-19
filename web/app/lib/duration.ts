/**
 * A print time in hours ("0.05", 1.5, null) as people say it: "3 min", "1 h 30 min", "12 h".
 * Empty or unreadable values show as "—". Whole minutes, rounded.
 */
export function formatHours(hours: string | number | null | undefined): string {
  const h =
    typeof hours === 'string'
      ? hours.trim() === ''
        ? null
        : Number(hours)
      : hours;
  if (h === null || h === undefined || !Number.isFinite(h) || h < 0) return '—';
  const minutes = Math.round(h * 60);
  if (minutes < 60) return `${minutes} min`;
  const whole = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${whole} h ${rest} min` : `${whole} h`;
}
