import { UnitCostCalculator } from '@forgea/pricing';
import {
  type Catalog,
  estimateItem,
  sizeLabel,
  valueKey,
} from './production-estimate.js';

// Round numbers: $1/h, 10% waste, 10% failures, $0.50 labour, $0.50 packaging, ×2.
const calculator = new UnitCostCalculator({
  machineRatePerHour: '1',
  purgeWastePercent: '10',
  failureAllowancePercent: '10',
  laborCostPerUnit: '0.5',
  packagingCostPerUnit: '0.5',
  profit: { kind: 'PERCENT', value: '100' },
});

const catalog: Catalog = {
  products: new Map([
    [
      'vase',
      {
        id: 'vase',
        name: 'Vase',
        category: 'Home',
        grams: '100',
        printHours: '5',
        materialId: 'pla',
        sizes: [
          {
            label: '10 × 10 × 10 cm',
            grams: '100',
            printHours: '5',
            isDefault: true,
          },
          {
            label: '20 × 10 × 5 cm',
            grams: '200',
            printHours: '8',
            isDefault: false,
          },
        ],
      },
    ],
    [
      'stand',
      {
        id: 'stand',
        name: 'Stand',
        category: null,
        grams: '50',
        printHours: '0',
        materialId: 'pla',
        sizes: [],
      },
    ],
  ]),
  values: new Map([
    [
      valueKey('Colour', 'Red'),
      {
        gramsMultiplier: '1',
        hoursMultiplier: '1',
        materialId: null,
        swatchHex: '#ff0000',
      },
    ],
    [
      valueKey('Finish', 'PETG'),
      {
        gramsMultiplier: '1.5',
        hoursMultiplier: '1',
        materialId: 'petg',
        swatchHex: null,
      },
    ],
  ]),
  pricePerGram: new Map([
    ['pla', '0.05'],
    ['petg', '0.1'],
  ]),
};

describe('estimateItem', () => {
  it('uses the chosen size’s grams and hours, and the colour from the swatched value', () => {
    // 200 × 0.05 = 10 + 8 h = 18; +20% = 21.60; + 1 = 22.60
    expect(
      estimateItem(catalog, calculator, 'vase', [
        { group: 'Size', value: '20 × 10 × 5 cm' },
        { group: 'Colour', value: 'Red' },
      ]),
    ).toEqual({
      unitCost: '22.60',
      gramsPerUnit: '200',
      hoursPerUnit: '8',
      materialId: 'pla',
      colour: 'Red',
    });
  });

  it('falls back to the default size, and switches material with its price', () => {
    // 150 g PETG × 0.10 = 15 + 5 h = 20; +20% = 24; + 1 = 25
    expect(
      estimateItem(catalog, calculator, 'vase', [
        { group: 'Finish', value: 'PETG' },
        { group: 'Engraving', value: 'Rana' },
      ]),
    ).toEqual({
      unitCost: '25.00',
      gramsPerUnit: '150',
      hoursPerUnit: '5',
      materialId: 'petg',
      colour: '',
    });
  });

  it('uses the product’s own grams without sizes', () => {
    expect(estimateItem(catalog, calculator, 'stand', [])).toMatchObject({
      unitCost: '4.00',
      gramsPerUnit: '50',
    });
  });

  it('has no estimate without a catalog product or a priced material', () => {
    expect(estimateItem(catalog, calculator, null, [])).toBeNull();
    expect(estimateItem(catalog, calculator, 'gone', [])).toBeNull();
    const unpriced: Catalog = { ...catalog, pricePerGram: new Map() };
    expect(estimateItem(unpriced, calculator, 'stand', [])).toBeNull();
    const broken: Catalog = {
      ...catalog,
      products: new Map([
        ['zero', { ...catalog.products.get('stand')!, grams: '0' }],
      ]),
    };
    expect(estimateItem(broken, calculator, 'zero', [])).toBeNull();
  });

  it('labels sizes the way orders store them', () => {
    expect(sizeLabel({ sizeXcm: '18', sizeYcm: '12.5', sizeZcm: '9' })).toBe(
      '18 × 12.5 × 9 cm',
    );
  });
});
