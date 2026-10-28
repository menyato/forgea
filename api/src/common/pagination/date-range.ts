/** `{ gte: from, lt: to }` for an optional ISO date range; `undefined` when neither is set. */
export function dateRange(
  from: string | undefined,
  to: string | undefined,
): { gte?: Date; lt?: Date } | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: new Date(from) } : {}),
    ...(to ? { lt: new Date(to) } : {}),
  };
}
