// The development examples as a catalog file — the same format the dashboard exports and
// imports (docs/CATALOG_IMPORT.md) — so the seed exercises the real import path.
import type { CatalogFile, CatalogProduct } from '@forgea/types';
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
const size = (values: string[], def: string) => ({
  group: 'Size',
  required: true,
  values,
  default: def,
});

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
        name: 'Size', kind: 'CHOICE', maxLength: null, textExtraPrice: '0', sortOrder: 2, active: true,
        values: [
          value('Small', { gramsMultiplier: '0.6', hoursMultiplier: '0.7' }, 0),
          value('Standard', {}, 1),
          value('Large', { gramsMultiplier: '1.8', hoursMultiplier: '1.5' }, 2),
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
    ],
    products: [
      // The studio's own mark, as a desk plaque; it stands in the centre of the home page's bed.
      product({
        slug: 'forgea-logo', name: 'Forgea logo plaque', category: 'designer', material: 'PLA', grams: '30', printHours: '2.5',
        designer: 'Forgea Studio',
        description: 'Our build-plate mark in four printed layers: plate, square, bar and F. A desk piece for makers.',
        options: [colour(['Black', 'Copper silk', ...DESIGNER_COLOURS.slice(0, 3)], 'Black')],
      }),
      // The designer collection: the studio's own pieces.
      product({
        slug: 'twist-vase', name: 'Twist vase', category: 'designer', material: 'PLA', grams: '95', printHours: '7',
        designer: 'Forgea Studio',
        description: 'Six faces that turn a third of a circle from base to rim. Watertight for fresh flowers.',
        options: [colour(DESIGNER_COLOURS, 'Sand'), size(['Small', 'Standard', 'Large'], 'Standard')],
      }),
      product({
        slug: 'faceted-planter', name: 'Faceted planter', category: 'designer', material: 'PETG', grams: '120', printHours: '8',
        designer: 'Forgea Studio',
        description: 'An eight-sided planter that opens towards the rim, in plant-safe PETG.',
        options: [colour(DESIGNER_COLOURS, 'Marble white'), size(['Standard', 'Large'], 'Standard')],
      }),
      product({
        slug: 'ribbed-pen-cup', name: 'Ribbed pen cup', category: 'designer', material: 'PLA', grams: '70', printHours: '4',
        designer: 'Forgea Studio',
        description: 'Twenty ribs catch the light around a desk-sized cup for pens and brushes.',
        options: [colour([...DESIGNER_COLOURS, 'Copper silk'], 'Black')],
      }),
      product({
        slug: 'spiral-tower', name: 'Spiral tower sculpture', category: 'designer', material: 'PLA', grams: '160', printHours: '9',
        designer: 'Forgea Studio',
        description: 'Twelve squares, each turned and a little smaller: a quiet desk sculpture.',
        options: [colour(DESIGNER_COLOURS, 'Ocean silk'), size(['Small', 'Standard'], 'Standard')],
      }),
      product({
        slug: 'honeycomb-shelf', name: 'Honeycomb wall shelf', category: 'designer', material: 'PETG', grams: '150', printHours: '9',
        designer: 'Forgea Studio',
        description: 'Seven hexagonal cells for small plants and keepsakes; screws to the wall.',
        options: [colour(DESIGNER_COLOURS, 'Sand')],
      }),
      // Everyday pieces.
      product({
        slug: 'cable-clip-set', name: 'Cable clip set (6)', category: 'home-desk', material: 'PLA', grams: '25', printHours: '1.5',
        description: 'Desk-edge clips that keep chargers and cables where you left them.',
        options: [colour(COLOURS, 'Black')],
      }),
      product({
        slug: 'phone-stand', name: 'Phone stand', category: 'home-desk', material: 'PLA', grams: '60', printHours: '3',
        description: 'A weighted stand with a charging-cable channel, for portrait or landscape.',
        options: [colour(COLOURS, 'Black'), size(['Small', 'Standard', 'Large'], 'Standard')],
      }),
      product({
        slug: 'pi-5-case', name: 'Raspberry Pi 5 case', category: 'electronics', material: 'PETG', grams: '120', printHours: '6',
        description: 'Vented case with fan mount and labelled ports. Heat-resistant PETG.',
        options: [
          colour(['Black', 'White'], 'Black'),
          { group: 'Material', required: true, values: ['PETG (heat-resistant)', 'ASA (outdoor, UV-stable)'], default: 'PETG (heat-resistant)' },
        ],
      }),
      product({
        slug: 'name-keychain', name: 'Custom name keychain', category: 'personalised', material: 'PLA', grams: '10', printHours: '0.75',
        isCustom: true,
        description: 'Your name or logo, printed in the colour you choose.',
        options: [colour(COLOURS, null), { group: 'Name on it', required: true, values: [], default: null }],
      }),
      product({
        slug: 'lamp-shade', name: 'Desk lamp shade', category: 'home-desk', material: 'PLA', grams: '150', printHours: '9',
        description: 'Faceted shade that throws a soft pattern on the wall. Fits E27 fittings.',
        options: [colour(['White', 'Copper silk'], 'White'), size(['Standard', 'Large'], 'Standard')],
      }),
      product({
        slug: 'sensor-enclosure', name: 'Outdoor sensor enclosure', category: 'electronics', material: 'ASA', grams: '180', printHours: '10',
        isCustom: true,
        description: 'Sized to your board, with cable glands and a gasket groove. UV-stable ASA.',
        options: [
          { group: 'Material', required: true, values: ['ASA (outdoor, UV-stable)', 'PETG (heat-resistant)'], default: 'ASA (outdoor, UV-stable)' },
          size(['Small', 'Standard', 'Large'], 'Standard'),
        ],
      }),
    ],
  };
}
