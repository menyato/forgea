import type { BufferGeometry } from 'three';
import {
  coupleNames,
  lettersOf,
  type LogoShape,
  PER_LETTER_STYLES,
  SUBTITLE_STYLES,
  subtitleProblem,
  type TextDesign,
  type TextSettings,
  textProblem,
} from './design.js';
import { partGeometry, volumeMm3 } from './geometry.js';
import { layoutDesign } from './layout.js';
import type { FontSet } from './shaper.js';

export * from './design.js';
export { stlBytes, stlFromPositions } from './geometry.js';
export {
  buildSlots,
  placementMatrix,
  slotsProblem,
  type BuiltSlot,
} from './slots.js';
export { faceAround } from './face.js';
export { logoFromSvg, logoRegionsFromSvg, MAX_LOGO_POINTS } from './svg.js';
export type { Region } from './outline.js';
export { FontSet, fontScripts, type FontSource } from './shaper.js';

/** A designed piece ready to show, price or print: one solid per colour. */
export interface BuiltDesign {
  parts: { colour: string; geometry: BufferGeometry; volumeMm3: number }[];
  /** Overall size, mm. */
  size: { x: number; y: number; z: number };
}

/**
 * Why the design can't be made, in the customer's words, or null: the text itself, then
 * every character having a letter in the font chosen for it.
 */
export function designProblem(
  fonts: FontSet,
  design: TextDesign,
  settings: TextSettings,
): string | null {
  const problem =
    textProblem(
      design.text,
      settings,
      settings.style === 'KEYCHAIN' && Boolean(design.logoId),
    ) ??
    (SUBTITLE_STYLES.includes(settings.style)
      ? subtitleProblem(design.subtitle)
      : null);
  if (problem) return problem;
  const missing = new Set<string>();
  if (PER_LETTER_STYLES.includes(settings.style)) {
    lettersOf(design.text).forEach((c, i) => {
      const font = design.letters?.[i]?.fontId ?? design.fontId;
      for (const m of fonts.missing(font, c)) missing.add(m);
    });
  } else {
    // A couple's "&" is a heart, not a letter.
    const text =
      settings.style === 'COUPLE'
        ? coupleNames(design.text).join(' ')
        : design.text;
    for (const m of fonts.missing(design.fontId, text)) missing.add(m);
    if (SUBTITLE_STYLES.includes(settings.style) && design.subtitle?.trim())
      for (const m of fonts.missing(design.fontId, design.subtitle.trim()))
        missing.add(m);
    if (settings.style === 'INITIAL_NAME') {
      const initial = lettersOf(design.text)[0] ?? '';
      const font = design.accentFontId ?? design.fontId;
      for (const m of fonts.missing(font, initial)) missing.add(m);
    }
  }
  return missing.size
    ? `This font has no ${[...missing].join(' ')}: choose another font`
    : null;
}

/** The design as solids, one per colour, with their volumes (mm³). */
export function buildDesign(
  fonts: FontSet,
  design: TextDesign,
  settings: TextSettings,
  /** The logos a keychain may carry (as `logoFromSvg` gives them, 1 across). */
  logos: ReadonlyMap<string, LogoShape> = new Map(),
): BuiltDesign {
  const layout = layoutDesign(fonts, design, settings, logos);
  return {
    parts: layout.parts.map((part) => {
      const geometry = partGeometry(part);
      return { colour: part.colour, geometry, volumeMm3: volumeMm3(geometry) };
    }),
    size: layout.size,
  };
}
