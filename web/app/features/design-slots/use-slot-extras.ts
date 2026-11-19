import type { SlotChoice } from '@forgea/text3d/design';
import type { ProductSlotsOffer } from '@forgea/types';
import { useEffect, useState } from 'react';
import type { ModelExtra } from '~/features/model-viewer/model-viewer';

/**
 * A product's text and logos, as chosen, ready to show on its model: made in the browser a
 * moment after the last change (three.js and the fonts load only then, only in the browser).
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
      import('./slot-geometry.client')
        .then(({ buildOfferSlots }) =>
          buildOfferSlots(
            offer,
            JSON.parse(key)[1] as Record<string, SlotChoice>,
          ),
        )
        .then(({ problem, built }) => {
          if (cancelled) {
            for (const b of built) b.geometry.dispose();
            return;
          }
          const hex = new Map(offer.colours.map((c) => [c.id, c.swatchHex]));
          setState((old) => {
            for (const e of old.extras) e.geometry.dispose();
            return {
              problem,
              extras: built.map((b) => ({
                geometry: b.geometry,
                color: hex.get(b.colour) ?? '#888888',
              })),
            };
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
