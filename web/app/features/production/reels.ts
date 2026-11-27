import type { PrintJobListItem } from '@forgea/types';

/**
 * What a run prints from, for its card and page: a 3MF line's reels picked on the order (all of
 * them, "PLA · White + PLA · Magenta"), else its one reel; null when none is chosen yet.
 */
export function reelsOf(
  j: Pick<PrintJobListItem, 'reel' | 'picked'>,
): string | null {
  const reels = j.picked.length > 0 ? j.picked : j.reel ? [j.reel] : [];
  if (reels.length === 0) return null;
  return reels
    .map((r) => `${r.material} · ${r.colour || 'no colour'}`)
    .join(' + ');
}
