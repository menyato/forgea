import type { DesignSummary } from '@forgea/types';

/**
 * How a personalised piece reads, in the cart, an order and the dashboard: the text, its
 * font and colours (each letter's, for initials and single letters) and its size. Spans only:
 * it sits inside an item's line.
 */
export function DesignLines({ design: d }: { design: DesignSummary }) {
  return (
    <span className="grid gap-0.5 text-sm">
      <span className="block min-w-0 break-words">
        <span dir="auto" className="font-semibold">
          “{d.text}”
        </span>{' '}
        in {d.font}, {d.textColour}
        {d.accentColour
          ? `, ${d.style === 'COUPLE' ? 'heart' : 'initial'} ${d.accentColour}`
          : ''}
        {d.accentFont ? ` (initial in ${d.accentFont})` : ''}
        {d.baseColour ? ` on ${d.baseColour}` : ''}
      </span>
      {d.letters && d.letters.length > 0 && (
        <span className="block text-text-muted">
          {d.letters
            .map((l) => `${l.char}: ${l.font}, ${l.colour}`)
            .join(' · ')}
        </span>
      )}
      <span className="block text-text-muted">
        {round(d.sizeMm.x)} × {round(d.sizeMm.y)} mm
      </span>
    </span>
  );
}

const round = (mm: number) => Math.round(mm);
