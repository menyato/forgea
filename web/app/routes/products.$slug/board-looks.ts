import {
  type BoardItem,
  type BoardMotif,
  nearestColour,
  type TextStyle,
} from '@forgea/text3d/design';
import type { ProductTextOffer } from '@forgea/types';

/**
 * Ready-made looks a board piece starts from: where things sit, as shares of the piece's
 * height, and the colours they aim for (the shop's closest filament is used). Customers change
 * anything after, so these are starting points, not rules: what prints is what they leave.
 */
interface LookItem {
  kind: BoardItem['kind'];
  text?: string;
  /** Which kind of font suits it: a flowing script for names, a plain one for dates. */
  font?: 'script' | 'plain' | 'bold';
  motif?: BoardMotif;
  /** A logo whose name matches this (the first offered when none does). */
  logo?: RegExp;
  x: number;
  y: number;
  size: number;
  rotation?: number;
  colour: 'accent' | 'base';
}
export interface BoardLook {
  label: string;
  /** A standing initial's letter. */
  initial: string;
  base: string;
  accent: string;
  items: LookItem[];
}

const BABY = (name: string): LookItem[] => [
  {
    kind: 'TEXT',
    text: name,
    font: 'script',
    x: 0,
    y: 0.02,
    size: 0.2,
    colour: 'accent',
  },
  {
    kind: 'TEXT',
    text: '22.08.2025',
    font: 'plain',
    x: 0,
    y: -0.3,
    size: 0.065,
    colour: 'accent',
  },
  {
    kind: 'TEXT',
    text: '3.250 kg',
    font: 'plain',
    x: 0,
    y: -0.38,
    size: 0.06,
    colour: 'accent',
  },
];

export const BOARD_LOOKS: Partial<Record<TextStyle, BoardLook[]>> = {
  STANDING_INITIAL: [
    {
      label: 'Baby girl',
      initial: 'L',
      base: '#f2ece2',
      accent: '#e8afcf',
      items: [
        ...BABY('Lina'),
        {
          kind: 'MOTIF',
          motif: 'HEART',
          x: 0.3,
          y: 0.15,
          size: 0.07,
          colour: 'accent',
        },
        {
          kind: 'MOTIF',
          motif: 'FLOWER',
          x: -0.3,
          y: -0.1,
          size: 0.06,
          colour: 'accent',
        },
        {
          kind: 'MOTIF',
          motif: 'BUTTERFLY',
          x: 0.36,
          y: 0.04,
          size: 0.07,
          rotation: -15,
          colour: 'accent',
        },
      ],
    },
    {
      label: 'Baby boy',
      initial: 'A',
      base: '#f2ece2',
      accent: '#6fb1e8',
      items: [
        ...BABY('Adam'),
        {
          kind: 'MOTIF',
          motif: 'MOON',
          x: 0.32,
          y: 0.15,
          size: 0.08,
          colour: 'accent',
        },
        {
          kind: 'MOTIF',
          motif: 'STAR',
          x: 0.22,
          y: 0.2,
          size: 0.04,
          colour: 'accent',
        },
        {
          kind: 'MOTIF',
          motif: 'STAR',
          x: -0.3,
          y: -0.1,
          size: 0.05,
          colour: 'accent',
        },
      ],
    },
    {
      label: 'Little prince(ss)',
      initial: 'M',
      base: '#ffffff',
      accent: '#d4a72c',
      items: [
        {
          kind: 'MOTIF',
          motif: 'CROWN',
          x: 0,
          y: 0.16,
          size: 0.09,
          colour: 'accent',
        },
        {
          kind: 'TEXT',
          text: 'Maya',
          font: 'script',
          x: 0,
          y: 0.02,
          size: 0.2,
          colour: 'accent',
        },
        {
          kind: 'TEXT',
          text: '01.01.2026',
          font: 'plain',
          x: 0,
          y: -0.32,
          size: 0.065,
          colour: 'accent',
        },
      ],
    },
  ],
  TROPHY: [
    {
      label: 'Best teacher',
      initial: '',
      base: '#1d1d1f',
      accent: '#d4a72c',
      items: [
        {
          kind: 'TEXT',
          text: 'BEST TEACHER',
          font: 'plain',
          x: 0,
          y: 0.36,
          size: 0.075,
          colour: 'accent',
        },
        {
          kind: 'LOGO',
          logo: /teach/i,
          x: 0,
          y: 0.06,
          size: 0.3,
          colour: 'accent',
        },
        {
          kind: 'TEXT',
          text: 'Ms. Rana',
          font: 'script',
          x: 0,
          y: -0.25,
          size: 0.1,
          colour: 'accent',
        },
        {
          kind: 'TEXT',
          text: '2026',
          font: 'plain',
          x: 0,
          y: -0.38,
          size: 0.06,
          colour: 'accent',
        },
        {
          kind: 'MOTIF',
          motif: 'STAR',
          x: -0.38,
          y: 0.36,
          size: 0.05,
          colour: 'accent',
        },
        {
          kind: 'MOTIF',
          motif: 'STAR',
          x: 0.38,
          y: 0.36,
          size: 0.05,
          colour: 'accent',
        },
      ],
    },
    {
      label: 'Champion',
      initial: '',
      base: '#1d1d1f',
      accent: '#d4a72c',
      items: [
        {
          kind: 'MOTIF',
          motif: 'CROWN',
          x: 0,
          y: 0.28,
          size: 0.17,
          colour: 'accent',
        },
        {
          kind: 'TEXT',
          text: 'CHAMPION',
          font: 'plain',
          x: 0,
          y: 0.04,
          size: 0.1,
          colour: 'accent',
        },
        {
          kind: 'TEXT',
          text: 'Karim',
          font: 'script',
          x: 0,
          y: -0.17,
          size: 0.1,
          colour: 'accent',
        },
        {
          kind: 'TEXT',
          text: '2026',
          font: 'plain',
          x: 0,
          y: -0.35,
          size: 0.06,
          colour: 'accent',
        },
      ],
    },
    {
      label: 'Thank you, doctor',
      initial: '',
      base: '#ffffff',
      accent: '#3a6ea5',
      items: [
        {
          kind: 'TEXT',
          text: 'THANK YOU',
          font: 'plain',
          x: 0,
          y: 0.36,
          size: 0.075,
          colour: 'accent',
        },
        {
          kind: 'LOGO',
          logo: /doctor|medic|nurse|pharm/i,
          x: 0,
          y: 0.06,
          size: 0.3,
          colour: 'accent',
        },
        {
          kind: 'TEXT',
          text: 'Dr. Sami',
          font: 'script',
          x: 0,
          y: -0.26,
          size: 0.1,
          colour: 'accent',
        },
      ],
    },
  ],
};

/** A flowing script font for names, a plain one for dates and titles, among those offered. */
export function fontFor(
  fonts: ProductTextOffer['fonts'],
  kind: 'script' | 'plain' | 'bold',
): string | undefined {
  const latin = fonts.filter((f) => f.latin);
  const script =
    /pacifico|script|dancing|great|sacramento|satisfy|parisienne|allura|cookie|lobster/i;
  const bold = /lalezar|black|bold|heavy|display|bungee|fredoka|baloo/i;
  const found =
    kind === 'script'
      ? latin.find((f) => script.test(f.name))
      : kind === 'bold'
        ? latin.find((f) => bold.test(f.name))
        : latin.find((f) => !script.test(f.name) && !bold.test(f.name));
  return (found ?? latin[0] ?? fonts[0])?.id;
}

let made = 0;
/** A new item's id: stable while the customer edits, unique on the page. */
export const itemId = () =>
  `i${Date.now().toString(36)}${(made++).toString(36)}`;

/** A look made for this product: its sizes in mm, its colours the shop's own, its fonts and logos. */
export function lookFor(
  look: BoardLook,
  offer: ProductTextOffer,
  heightMm: number,
): { initial: string; baseColour: string; items: BoardItem[] } {
  const colour = (hex: string) =>
    nearestColour(hex, offer.colours)?.id ?? offer.colours[0]?.id ?? '';
  const accent = colour(look.accent);
  const base = colour(look.base);
  const items = look.items.flatMap((i): BoardItem[] => {
    const logo =
      i.kind === 'LOGO'
        ? (offer.logos.find((l) => i.logo?.test(l.name)) ?? offer.logos[0])
        : undefined;
    if (i.kind === 'LOGO' && !logo) return [];
    const font = i.font ? fontFor(offer.fonts, i.font) : undefined;
    return [
      {
        id: itemId(),
        kind: i.kind,
        ...(i.text ? { text: i.text } : {}),
        ...(font ? { fontId: font } : {}),
        ...(i.motif ? { motif: i.motif } : {}),
        ...(logo ? { logoId: logo.id } : {}),
        x: Math.round(i.x * heightMm * 10) / 10,
        y: Math.round(i.y * heightMm * 10) / 10,
        size: Math.round(i.size * heightMm * 10) / 10,
        rotation: i.rotation ?? 0,
        colour: i.colour === 'accent' ? accent : base,
      },
    ];
  });
  return { initial: look.initial, baseColour: base, items };
}
