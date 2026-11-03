// The development examples as a catalog file — the same format the dashboard exports and
// imports (docs/CATALOG_IMPORT.md) — so the seed exercises the real import path.
import { type CatalogFile, type CatalogProduct, scaledSize } from '@forgea/types';
import { readFileSync } from 'node:fs';
import { EXAMPLE_MODELS } from './example-models.ts';

type ModelName = keyof typeof EXAMPLE_MODELS;

const value = (
  label: string,
  extra: Partial<CatalogFile['optionGroups'][number]['values'][number]> = {},
  sortOrder = 0,
) => ({
  label,
  swatchHex: null,
  gramsMultiplier: '1',
  hoursMultiplier: '1',
  extraPrice: '0',
  material: null,
  sortOrder,
  active: true,
  ...extra,
});

const COLOURS = ['Black', 'White', 'Forest green', 'Copper silk'];
const DESIGNER_COLOURS = ['Sand', 'Marble white', 'Ocean silk', 'Black'];

const model = (name: ModelName) => ({
  name: `${name}.stl`,
  base64: EXAMPLE_MODELS[name]().toString('base64'),
});

/** A product with its example model (when one exists) and the options it offers. */
function product(
  p: Omit<CatalogProduct, 'model' | 'images' | 'active' | 'isCustom' | 'designer'> &
    Partial<Pick<CatalogProduct, 'isCustom' | 'designer'>>,
): CatalogProduct {
  return {
    isCustom: false,
    designer: null,
    active: true,
    images: [],
    model: p.slug in EXAMPLE_MODELS ? model(p.slug as ModelName) : null,
    ...p,
  };
}

const colour = (values: string[], def: string | null) => ({
  group: 'Colour',
  required: true,
  values,
  default: def,
});
type Cm = { x: string; y: string; z: string };
const cm = (x: number, y: number, z: number): Cm => ({
  x: x.toFixed(1),
  y: y.toFixed(1),
  z: z.toFixed(1),
});

/**
 * The real sizes a product is sold in, from its measured size (which its grams and hours are
 * for): each label with its height as a share of that one; the other measurements, grams and
 * hours follow (scaledSize). The first label with share 1 is the default.
 */
function sizes(
  measured: { size: Cm; grams: string; printHours: string },
  shares: [label: string, share: number][],
): NonNullable<CatalogProduct['sizes']> {
  return shares.map(([label, share]) => {
    const scaled = scaledSize(measured, 'z', Number(measured.size.z) * share);
    return {
      label,
      size: scaled.size,
      grams: scaled.grams,
      printHours: scaled.printHours,
      default: share === 1,
    };
  });
}

/** A product's measured size, and its sizes when it comes in more than one. */
const measured = (
  p: { grams: string; printHours: string },
  size: Cm,
  shares?: [string, number][],
) => ({
  size,
  ...(shares ? { sizes: sizes({ size, ...p }, shares) } : {}),
});

const SMALL_STANDARD_LARGE: [string, number][] = [
  ['Small', 0.75],
  ['Standard', 1],
  ['Large', 1.3],
];
const STANDARD_LARGE: [string, number][] = [
  ['Standard', 1],
  ['Large', 1.3],
];

export function exampleCatalog(): CatalogFile {
  return {
    format: 'forgea-catalog',
    version: 1,
    // The three materials come from the first migration; only their print rates are new.
    materials: [],
    categories: [
      { slug: 'designer', name: 'Designer collection', description: 'Pieces drawn in our studio and printed to order.', sortOrder: 0, active: true },
      { slug: 'home-desk', name: 'Home & desk', description: null, sortOrder: 1, active: true },
      { slug: 'electronics', name: 'Electronics enclosures', description: null, sortOrder: 2, active: true },
      { slug: 'personalised', name: 'Personalised gifts', description: null, sortOrder: 3, active: true },
    ],
    optionGroups: [
      {
        name: 'Colour', kind: 'CHOICE', maxLength: null, textExtraPrice: '0', sortOrder: 1, active: true,
        values: [
          value('Black', { swatchHex: '#1c1c1c' }, 0),
          value('White', { swatchHex: '#f2f2ee' }, 1),
          value('Forest green', { swatchHex: '#2f5d3a' }, 2),
          value('Copper silk', { swatchHex: '#b87333', extraPrice: '1.50' }, 3),
          value('Sand', { swatchHex: '#d8c3a0' }, 4),
          value('Marble white', { swatchHex: '#e9e6df', extraPrice: '2.00' }, 5),
          value('Ocean silk', { swatchHex: '#2f6f8f', extraPrice: '1.50' }, 6),
        ],
      },
      {
        name: 'Material', kind: 'CHOICE', maxLength: null, textExtraPrice: '0', sortOrder: 3, active: true,
        values: [
          value('PETG (heat-resistant)', { material: 'PETG' }, 0),
          value('ASA (outdoor, UV-stable)', { material: 'ASA' }, 1),
        ],
      },
      { name: 'Name on it', kind: 'TEXT', maxLength: 12, textExtraPrice: '1.00', sortOrder: 4, active: true, values: [] },
      // The filament colours personalised pieces are printed in (letters and backing).
      {
        name: 'Text colours', kind: 'CHOICE', maxLength: null, textExtraPrice: '0', sortOrder: 5, active: true,
        values: [
          value('Black', { swatchHex: '#1c1c1c' }, 0),
          value('White', { swatchHex: '#f2f2ee' }, 1),
          value('Sand', { swatchHex: '#d8c3a0' }, 2),
          value('Red', { swatchHex: '#b3282d' }, 3),
          value('Sky blue', { swatchHex: '#5aa9e6' }, 4),
          value('Forest green', { swatchHex: '#2f5d3a' }, 5),
          value('Gold silk', { swatchHex: '#c9a227' }, 6),
          value('Copper silk', { swatchHex: '#b87333' }, 7),
        ],
      },
    ],
    // Free fonts (SIL Open Font License: may be used to make and sell printed items), in
    // prisma/example-fonts with their licences.
    fonts: (
      [
        ['Cairo', 'Cairo.ttf'],
        ['Lalezar', 'Lalezar.ttf'],
        ['Pacifico', 'Pacifico.ttf'],
        ['Aref Ruqaa', 'ArefRuqaa.ttf'],
      ] as const
    ).map(([name, file], sortOrder) => ({
      name,
      active: true,
      sortOrder,
      file: {
        name: file,
        base64: readFileSync(new URL(`./example-fonts/${file}`, import.meta.url)).toString('base64'),
      },
    })),
    products: [
      // The studio's own mark, as a desk plaque; it stands in the centre of the home page's bed.
      product({
        slug: 'forgea-logo', name: 'Forgea logo plaque', category: 'designer', material: 'PLA', grams: '30', printHours: '2.5',
        ...measured({ grams: '30', printHours: '2.5' }, cm(10, 10, 1.2)),
        designer: 'Forgea Studio',
        description: 'Our build-plate mark in four printed layers: plate, square, bar and F. A desk piece for makers.',
        options: [colour(['Black', 'Copper silk', ...DESIGNER_COLOURS.slice(0, 3)], 'Black')],
      }),
      // The designer collection: the studio's own pieces.
      product({
        slug: 'twist-vase', name: 'Twist vase', category: 'designer', material: 'PLA', grams: '95', printHours: '7',
        ...measured({ grams: '95', printHours: '7' }, cm(9, 9, 18), SMALL_STANDARD_LARGE),
        designer: 'Forgea Studio',
        description: 'Six faces that turn a third of a circle from base to rim. Watertight for fresh flowers.',
        options: [colour(DESIGNER_COLOURS, 'Sand')],
      }),
      product({
        slug: 'faceted-planter', name: 'Faceted planter', category: 'designer', material: 'PETG', grams: '120', printHours: '8',
        ...measured({ grams: '120', printHours: '8' }, cm(12, 12, 11), STANDARD_LARGE),
        designer: 'Forgea Studio',
        description: 'An eight-sided planter that opens towards the rim, in plant-safe PETG.',
        options: [colour(DESIGNER_COLOURS, 'Marble white')],
      }),
      product({
        slug: 'ribbed-pen-cup', name: 'Ribbed pen cup', category: 'designer', material: 'PLA', grams: '70', printHours: '4',
        ...measured({ grams: '70', printHours: '4' }, cm(8, 8, 10)),
        designer: 'Forgea Studio',
        description: 'Twenty ribs catch the light around a desk-sized cup for pens and brushes.',
        options: [colour([...DESIGNER_COLOURS, 'Copper silk'], 'Black')],
      }),
      product({
        slug: 'spiral-tower', name: 'Spiral tower sculpture', category: 'designer', material: 'PLA', grams: '160', printHours: '9',
        ...measured({ grams: '160', printHours: '9' }, cm(8, 8, 22), [['Small', 0.7], ['Standard', 1]]),
        designer: 'Forgea Studio',
        description: 'Twelve squares, each turned and a little smaller: a quiet desk sculpture.',
        options: [colour(DESIGNER_COLOURS, 'Ocean silk')],
      }),
      product({
        slug: 'honeycomb-shelf', name: 'Honeycomb wall shelf', category: 'designer', material: 'PETG', grams: '150', printHours: '9',
        ...measured({ grams: '150', printHours: '9' }, cm(30, 9, 26)),
        designer: 'Forgea Studio',
        description: 'Seven hexagonal cells for small plants and keepsakes; screws to the wall.',
        options: [colour(DESIGNER_COLOURS, 'Sand')],
      }),
      // Everyday pieces.
      product({
        slug: 'cable-clip-set', name: 'Cable clip set (6)', category: 'home-desk', material: 'PLA', grams: '25', printHours: '1.5',
        ...measured({ grams: '25', printHours: '1.5' }, cm(4, 2, 1.5)),
        description: 'Desk-edge clips that keep chargers and cables where you left them, each with the name you give it.',
        options: [colour(COLOURS, 'Black'), { group: 'Name on it', required: true, values: [], default: null }],
      }),
      product({
        slug: 'phone-stand', name: 'Phone stand', category: 'home-desk', material: 'PLA', grams: '60', printHours: '3',
        ...measured({ grams: '60', printHours: '3' }, cm(8, 9.5, 12), SMALL_STANDARD_LARGE),
        description: 'A weighted stand with a charging-cable channel, for portrait or landscape.',
        options: [colour(COLOURS, 'Black')],
      }),
      product({
        slug: 'pi-5-case', name: 'Raspberry Pi 5 case', category: 'electronics', material: 'PETG', grams: '120', printHours: '6',
        ...measured({ grams: '120', printHours: '6' }, cm(9.4, 6.6, 3.2)),
        description: 'Vented case with fan mount and labelled ports. Heat-resistant PETG.',
        options: [
          colour(['Black', 'White'], 'Black'),
          { group: 'Material', required: true, values: ['PETG (heat-resistant)', 'ASA (outdoor, UV-stable)'], default: 'PETG (heat-resistant)' },
        ],
      }),
      // Personalised pieces: the customer types, picks fonts and colours, and sees it in 3D.
      product({
        slug: 'name-keychain', name: 'Name keychain', category: 'personalised', material: 'PLA', grams: '8', printHours: '0.8',
        description: 'Your name in raised letters on a backing that follows them, with a ring for your keys. Arabic or English, in the fonts and colours you choose.',
        options: [],
        text: { style: 'KEYCHAIN', maxChars: 12, letterHeightMm: '10', letterDepthMm: '1.6', baseDepthMm: '2.4', maxWidthMm: '75', colourGroup: 'Text colours', extraColourPrice: '1.00', sizesMm: ['13', '16'], defaultColour: 'Copper silk', defaultBaseColour: 'Black' },
      }),
      product({
        slug: 'standing-name', name: 'Your name, standing', category: 'personalised', material: 'PLA', grams: '45', printHours: '3',
        description: 'A big name for a desk or a shelf, its letters joined on one backing so it stands as one piece. Arabic or English.',
        options: [],
        text: { style: 'NAME', maxChars: 12, letterHeightMm: '30', letterDepthMm: '6', baseDepthMm: '3', maxWidthMm: '220', colourGroup: 'Text colours', extraColourPrice: '2.00', sizesMm: ['40', '50'], defaultColour: 'Copper silk', defaultBaseColour: 'Black' },
      }),
      product({
        slug: 'curved-initials', name: 'Curved initials', category: 'personalised', material: 'PLA', grams: '35', printHours: '2.5',
        description: 'Up to three initials curving together, the middle one larger and in front, each in its own font and colour.',
        options: [],
        text: { style: 'MONOGRAM', maxChars: 3, letterHeightMm: '40', letterDepthMm: '5', baseDepthMm: '3', maxWidthMm: '160', colourGroup: 'Text colours', extraColourPrice: '1.50', sizesMm: ['60', '80'], defaultColour: 'Copper silk', defaultBaseColour: 'Black' },
      }),
      product({
        slug: 'single-letters', name: 'Single letters', category: 'personalised', material: 'PLA', grams: '25', printHours: '2',
        description: 'Letters as separate pieces, each in its own font and colour: a word for a wall, a door, a shelf.',
        options: [],
        text: { style: 'LETTERS', maxChars: 10, letterHeightMm: '50', letterDepthMm: '8', baseDepthMm: '3', maxWidthMm: '400', colourGroup: 'Text colours', extraColourPrice: '1.00', sizesMm: ['80', '100'], defaultColour: 'Copper silk', defaultBaseColour: 'Black' },
      }),
      // Decorated templates: a big initial with the name across it, and two names with a heart.
      product({
        slug: 'baby-initial-name', name: "Baby's initial and name", category: 'personalised', material: 'PLA', grams: '60', printHours: '4',
        description: "The baby's first letter big, the whole name across it, flowers and a heart around it. For a nursery shelf or a birth gift.",
        options: [],
        text: { style: 'INITIAL_NAME', maxChars: 12, letterHeightMm: '80', letterDepthMm: '4', baseDepthMm: '3', maxWidthMm: '200', colourGroup: 'Text colours', extraColourPrice: '2.00', sizesMm: ['100', '120'], decor: 'FLOWERS', defaultColour: 'Copper silk', defaultAccentColour: 'White', defaultBaseColour: 'Black' },
      }),
      product({
        slug: 'boy-initial-name', name: "Boy's initial and name", category: 'personalised', material: 'PLA', grams: '60', printHours: '4',
        description: 'His first letter big under a crown, his whole name across it and stars around it. For his room or his desk.',
        options: [],
        text: { style: 'INITIAL_NAME', maxChars: 12, letterHeightMm: '80', letterDepthMm: '4', baseDepthMm: '3', maxWidthMm: '200', colourGroup: 'Text colours', extraColourPrice: '2.00', sizesMm: ['100', '120'], decor: 'CROWN', defaultColour: 'Copper silk', defaultAccentColour: 'White', defaultBaseColour: 'Black' },
      }),
      product({
        slug: 'couple-names', name: 'Two names and a heart', category: 'personalised', material: 'PLA', grams: '40', printHours: '3',
        description: 'Your two names with a heart between them, standing as one piece. For an anniversary, a wedding table or a gift.',
        options: [],
        text: { style: 'COUPLE', maxChars: 10, letterHeightMm: '30', letterDepthMm: '5', baseDepthMm: '3', maxWidthMm: '250', colourGroup: 'Text colours', extraColourPrice: '2.00', sizesMm: ['40'], defaultColour: 'Copper silk', defaultAccentColour: 'Red', defaultBaseColour: 'Black' },
      }),
      product({
        slug: 'lamp-shade', name: 'Desk lamp shade', category: 'home-desk', material: 'PLA', grams: '150', printHours: '9',
        ...measured({ grams: '150', printHours: '9' }, cm(16, 16, 14), STANDARD_LARGE),
        description: 'Faceted shade that throws a soft pattern on the wall. Fits E27 fittings.',
        options: [colour(['White', 'Copper silk'], 'White')],
      }),
      product({
        slug: 'sensor-enclosure', name: 'Outdoor sensor enclosure', category: 'electronics', material: 'ASA', grams: '180', printHours: '10',
        ...measured({ grams: '180', printHours: '10' }, cm(12, 8, 6), SMALL_STANDARD_LARGE),
        isCustom: true,
        description: 'Sized to your board, with cable glands and a gasket groove. UV-stable ASA.',
        options: [
          { group: 'Material', required: true, values: ['ASA (outdoor, UV-stable)', 'PETG (heat-resistant)'], default: 'ASA (outdoor, UV-stable)' },
        ],
      }),
    ],
  };
}
