import type { SlotSummary } from '@forgea/types';

/**
 * A product's text and logos as chosen, in the cart, an order and the dashboard: "Name:
 * “Sara” in Cairo, White", "Logo: Forgea mark, Black". Spans only: it sits inside an item's line.
 */
export function SlotLines({ slots }: { slots: readonly SlotSummary[] }) {
  if (slots.length === 0) return null;
  return (
    <span className="grid gap-0.5 text-sm">
      {slots.map((s) => (
        <span key={s.slotId} className="block min-w-0 break-words">
          {s.label}:{' '}
          {s.kind === 'TEXT' ? (
            <>
              <span dir="auto" className="font-semibold">
                “{s.text}”
              </span>{' '}
              in {s.font}, {s.colour}
            </>
          ) : (
            <>
              {s.logo}, {s.colour}
            </>
          )}
        </span>
      ))}
    </span>
  );
}
