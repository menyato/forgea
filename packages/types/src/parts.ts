/** A colour customers may pick a part in (an option value with a swatch). */
export interface PartChoice {
  label: string;
  swatchHex: string | null;
  /** The filament it is printed from, when the owner linked one. */
  stockItemId?: string | null;
}

/** A product's colour row that customers recolour. */
export interface PartRow {
  /** The choice the owner picked for it to start in (its label); null = automatic. */
  startsAs?: string | null;
  /** The colour as the shop names it. */
  colour: string;
  /** The file's colour, #rrggbb. */
  hex: string;
  /** The filament it is printed from. */
  stockItemId?: string | null;
}

/** A colour a product is first shown and printed in: a recoloured part's starting choice, or a fixed colour. */
export interface ShownColour {
  /** The part customers recolour; null for a colour that is always the same. */
  part: string | null;
  colour: string;
  /** #rrggbb */
  hex: string;
}

/**
 * The colours a product starts in, row by row: each recoloured part in its starting choice (as
 * the shop shows it first), every other colour as the file and its filament have it.
 */
export function shownColours(
  rows: readonly (PartRow & { part: string | null })[],
  choices: readonly PartChoice[] | null | undefined,
): ShownColour[] {
  return rows.map((row) => {
    const start =
      row.part && choices?.length ? startingChoice(choices, row) : undefined;
    return start
      ? { part: row.part, colour: start.label, hex: start.swatchHex ?? row.hex }
      : { part: null, colour: row.colour, hex: row.hex };
  });
}

const rgb = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return m
    ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)]
    : null;
};

/**
 * The colour a part starts in on the product page (and prices "from"): the one the owner picked;
 * else the choice printed from the same filament; else the one named like it; else the choice
 * closest to the file's colour; else the first. Never a colour unrelated to the file just
 * because it comes first in the list.
 */
export function startingChoice<T extends PartChoice>(
  choices: readonly T[],
  row: PartRow,
): T | undefined {
  const same = (a: string, b: string) =>
    a.trim().toLowerCase() === b.trim().toLowerCase();
  const picked = row.startsAs
    ? choices.find((c) => same(c.label, row.startsAs!))
    : undefined;
  if (picked) return picked;
  const reel = row.stockItemId
    ? choices.find((c) => c.stockItemId === row.stockItemId)
    : undefined;
  if (reel) return reel;
  const named = choices.find((c) => same(c.label, row.colour));
  if (named) return named;
  const target = rgb(row.hex);
  if (target) {
    let best: T | undefined;
    let bestDistance = Infinity;
    for (const c of choices) {
      const v = c.swatchHex ? rgb(c.swatchHex) : null;
      if (!v) continue;
      const d =
        (v[0] - target[0]) ** 2 +
        (v[1] - target[1]) ** 2 +
        (v[2] - target[2]) ** 2;
      if (d < bestDistance) {
        best = c;
        bestDistance = d;
      }
    }
    if (best) return best;
  }
  return choices[0];
}
