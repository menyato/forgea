import type { ShownColour } from '@forgea/types';
import { Swatch } from '~/features/stock/stock-ui';

/**
 * The colours a product starts in, beside its 3D model: each recoloured part in its starting
 * choice ("Body: Pink"), every other colour as it prints. The same colour twice shows once.
 */
export function ShownColours({
  colours,
  className = '',
}: {
  colours: readonly ShownColour[];
  className?: string;
}) {
  const seen = new Set<string>();
  const list = colours.filter((c) => {
    const key = `${c.part ?? ''}|${c.colour}|${c.hex}`;
    return !seen.has(key) && seen.add(key);
  });
  if (list.length === 0) return null;
  return (
    <ul
      aria-label="Shown in"
      className={`flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-muted ${className}`}
    >
      {list.map((c) => (
        <li
          key={`${c.part ?? ''}|${c.colour}|${c.hex}`}
          className="flex min-w-0 items-center gap-1"
        >
          <Swatch hex={c.hex} />
          <span className="truncate">
            {c.part ? `${c.part}: ${c.colour}` : c.colour}
          </span>
        </li>
      ))}
    </ul>
  );
}
