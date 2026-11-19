import {
  buildSlots,
  type BuiltSlot,
  type SlotChoice,
  slotsProblem,
  slotState,
} from '@forgea/text3d';
import type { ProductSlotsOffer } from '@forgea/types';
import { fontsFor } from '~/features/text-studio/font-set.client';

/**
 * A product's text and logos as chosen, made in the browser by the same code the studio
 * prints from (@forgea/text3d): what the customer sees on the model is what is printed. The
 * problem, when there is one, is in the customer's words.
 */
export async function buildOfferSlots(
  offer: ProductSlotsOffer,
  choices: Readonly<Record<string, SlotChoice>>,
): Promise<{ problem: string | null; built: BuiltSlot[] }> {
  const ids = [
    ...new Set(
      offer.slots.flatMap((s) => {
        if (s.kind !== 'TEXT') return [];
        const state = slotState(s, choices[s.id]);
        return state.on && state.fontId ? [state.fontId] : [];
      }),
    ),
  ];
  const fonts = await fontsFor(offer.fonts, ids);
  const problem = slotsProblem(fonts, offer.slots, choices);
  if (problem) return { problem, built: [] };
  return {
    problem: null,
    built: buildSlots(
      fonts,
      offer.slots,
      choices,
      new Map(offer.logos.map((l) => [l.id, l.outline])),
    ),
  };
}
