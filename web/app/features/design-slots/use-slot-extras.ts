import type { SlotChoice } from '@forgea/text3d/design';
import type { ProductSlotsOffer } from '@forgea/types';
import { useEffect, useState } from 'react';
import type { ModelExtra } from '~/features/model-viewer/model-viewer';
import { geometryOf, text3d } from '~/features/text3d-worker/text3d.client';

/**
 * A product's text and logos, as chosen, ready to show on its model: made a moment after the
 * last change, in the text studio's worker (fitting them to their faces can take a second on
 * a phone, and typing must not wait for it), only in the browser.
 */
export function useSlotExtras(
  offer: ProductSlotsOffer | null,
  choices: Readonly<Record<string, SlotChoice>>,
): { extras: ModelExtra[]; problem: string | null } {
  const [state, setState] = useState<{
    extras: ModelExtra[];
    problem: string | null;
  }>({ extras: [], problem: null });
  const key = JSON.stringify([offer?.slots ?? [], choices]);
  useEffect(() => {
    if (!offer || offer.slots.length === 0) {
      setState({ extras: [], problem: null });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      text3d({
        kind: 'slots',
        offer,
        choices: JSON.parse(key)[1] as Record<string, SlotChoice>,
      })
        .then(async ({ problem, solids }) => {
          if (cancelled) return;
          const hex = new Map(offer.colours.map((c) => [c.id, c.swatchHex]));
          const extras = await Promise.all(
            solids.map(async (s) => ({
              geometry: await geometryOf(s),
              color: hex.get(s.colour) ?? '#888888',
            })),
          );
          if (cancelled) {
            for (const e of extras) e.geometry.dispose();
            return;
          }
          setState((old) => {
            for (const e of old.extras) e.geometry.dispose();
            return { problem, extras };
          });
        })
        .catch((error: unknown) => {
          if (!cancelled)
            setState((old) => ({
              ...old,
              problem: error instanceof Error ? error.message : String(error),
            }));
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, offer]);
  return state;
}
