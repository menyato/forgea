import { BadRequestException } from '@nestjs/common';
import { UnitCostCalculator } from '@forgea/pricing';
import { PRODUCT_SIZE_GROUP_ID } from '@forgea/types';
import { Prisma } from '../generated/prisma/client.js';
import { OptionKind } from '../generated/prisma/enums.js';
import {
  type ConfigurableProduct,
  partGroupId,
  ProductConfigurator,
} from './product-configurator.js';

const D = (v: string | number) => new Prisma.Decimal(v);
const now = new Date();

function group(id: string, name: string, kind: OptionKind, extra = {}) {
  return {
    id,
    name,
    kind,
    maxLength: kind === OptionKind.TEXT ? 6 : null,
    textExtraPrice: D(kind === OptionKind.TEXT ? '1.00' : 0),
    sortOrder: 0,
    active: true,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

function value(id: string, groupId: string, label: string, extra = {}) {
  return {
    productId: 'p',
    valueId: id,
    isDefault: false,
    value: {
      id,
      groupId,
      label,
      swatchHex: null,
      gramsMultiplier: D(1),
      hoursMultiplier: D(1),
      extraPrice: D(0),
      materialId: null,
      material: null,
      stockItemId: null,
      sortOrder: 0,
      active: true,
      createdAt: now,
      updatedAt: now,
      ...extra,
    },
  };
}

/** A product offering Colour (Black default, Copper +$2, a switched-off Red), Size and Name. */
function product(): ConfigurableProduct {
  return {
    id: 'p',
    slug: 'tag',
    name: 'Tag',
    description: 'A tag',
    categoryId: null,
    category: null,
    imageKeys: [],
    modelFileKey: null,
    plateOrder: null,
    grams: D(10),
    printHours: D(1),
    materialId: 'm',
    material: {
      code: 'PLA',
      name: 'PLA',
      pricePerGram: D('0.10'),
      densityGPerCm3: D('1.24'),
      gramsPerHour: D('12'),
    },
    sizeXcm: null,
    sizeYcm: null,
    sizeZcm: null,
    sizes: [],
    colours: [],
    partColourGroupId: null,
    designSlots: [],
    textShapes: [],
    textLogoIds: [],
    partColourGroup: null,
    slicedFile: false,
    printFiles: [],
    extraCosts: [],
    profitKind: null,
    profitValue: null,
    priceOverride: null,
    textStyle: null,
    textMaxChars: null,
    textHeightMm: null,
    textDepthMm: null,
    textBaseMm: null,
    textMaxWidthMm: null,
    textColourGroupId: null,
    textColourGroup: null,
    textExtraColourPrice: D(0),
    textSizesMm: [],
    textDefaultColourId: null,
    textDefaultBaseId: null,
    textDefaultAccentId: null,
    textDecor: null,
    isCustom: false,
    designer: null,
    active: true,
    studioOnly: false,
    createdAt: now,
    updatedAt: now,
    optionGroups: [
      {
        productId: 'p',
        groupId: 'colour',
        required: true,
        sortOrder: 0,
        group: group('colour', 'Colour', OptionKind.CHOICE),
      },
      {
        productId: 'p',
        groupId: 'size',
        required: true,
        sortOrder: 1,
        group: group('size', 'Size', OptionKind.CHOICE),
      },
      {
        productId: 'p',
        groupId: 'name',
        required: false,
        sortOrder: 2,
        group: group('name', 'Name', OptionKind.TEXT),
      },
      {
        productId: 'p',
        groupId: 'finish',
        required: true,
        sortOrder: 3,
        group: group('finish', 'Finish', OptionKind.CHOICE, { active: false }),
      },
    ],
    optionValues: [
      { ...value('black', 'colour', 'Black'), isDefault: true },
      value('copper', 'colour', 'Copper', { extraPrice: D(2) }),
      value('red', 'colour', 'Red', { active: false }),
      value('small', 'size', 'Small'),
      value('large', 'size', 'Large', { gramsMultiplier: D(2) }),
      value('matte', 'finish', 'Matte'),
    ],
  } as ConfigurableProduct;
}

const configurator = new ProductConfigurator();
const fails = (selections: object[], message: string) =>
  expect(() => configurator.configure(product(), selections as never)).toThrow(
    new BadRequestException(message),
  );

describe('ProductConfigurator', () => {
  it('offers active groups and values only, with defaults, and no price rules', () => {
    const offered = configurator.offered(product());
    expect(offered.map((o) => o.name)).toEqual(['Colour', 'Size', 'Name']);
    expect(offered[0]).toEqual({
      groupId: 'colour',
      name: 'Colour',
      kind: OptionKind.CHOICE,
      required: true,
      maxLength: null,
      choices: [
        { id: 'black', label: 'Black', swatchHex: null },
        { id: 'copper', label: 'Copper', swatchHex: null },
      ],
      defaultValueId: 'black',
    });
  });

  it('fills in defaults and skips optional options left empty', () => {
    const c = configurator.configure(product(), [
      { groupId: 'size', valueId: 'small' },
    ]);
    expect(c.chosen).toEqual([
      { group: 'Colour', value: 'Black' },
      { group: 'Size', value: 'Small' },
    ]);
  });

  it('gives the same line key whatever order the choices come in', () => {
    const a = configurator.configure(product(), [
      { groupId: 'size', valueId: 'large' },
      { groupId: 'name', text: ' Rana ' },
    ]);
    const b = configurator.configure(product(), [
      { groupId: 'name', text: 'Rana' },
      { groupId: 'size', valueId: 'large' },
    ]);
    expect(a.configKey).toBe(b.configKey);
    expect(a.chosen.at(-1)).toEqual({ group: 'Name', value: 'Rana' });
  });

  it.each([
    [[{ groupId: 'colour', valueId: 'black' }], 'Choose a Size'],
    [[{ groupId: 'size', valueId: 'medium' }], 'This Size is not available'],
    [
      [
        { groupId: 'size', valueId: 'small' },
        { groupId: 'colour', valueId: 'red' },
      ],
      'This Colour is not available',
    ],
    [[{ groupId: 'size', text: 'big' }], 'Choose a Size from the list'],
    [
      [
        { groupId: 'size', valueId: 'small' },
        { groupId: 'name', valueId: 'small' },
      ],
      'Type the Name',
    ],
    [
      [
        { groupId: 'size', valueId: 'small' },
        { groupId: 'name', text: 'Too long' },
      ],
      'Name: at most 6 characters',
    ],
    [
      [{ groupId: 'finish', valueId: 'matte' }],
      'One of these options is not available',
    ],
    [
      [
        { groupId: 'size', valueId: 'small' },
        { groupId: 'size', valueId: 'large' },
      ],
      'One of these options is not available',
    ],
  ])('refuses %j', (selections, message) => fails(selections, message));

  it('requires a text option when the product says so', () => {
    const p = product();
    p.optionGroups[2]!.required = true;
    expect(() =>
      configurator.configure(p, [{ groupId: 'size', valueId: 'small' }]),
    ).toThrow(new BadRequestException('Enter the Name'));
  });

  it('quotes the shop price from the defaults, the first choice and a one-letter text', () => {
    const p = product();
    p.optionGroups[2]!.required = true;
    expect(configurator.starting(p).chosen).toEqual([
      { group: 'Colour', value: 'Black' },
      { group: 'Size', value: 'Small' },
      { group: 'Name', value: 'A' },
    ]);
  });

  it('shows the model in the default colour, else the first one with a swatch', () => {
    const p = product();
    expect(configurator.previewColor(p)).toBeNull();
    p.optionValues[1]!.value.swatchHex = '#b87333';
    expect(configurator.previewColor(p)).toBe('#b87333');
    p.optionValues[0]!.value.swatchHex = '#1c1c1c';
    expect(configurator.previewColor(p)).toBe('#1c1c1c');
  });

  it('prices with every rule: multipliers, add-ons and the text price', () => {
    const calculator = new UnitCostCalculator({
      machineRatePerHour: 0,
      purgeWastePercent: 0,
      failureAllowancePercent: 0,
      laborCostPerUnit: 0,
      packagingCostPerUnit: 0,
      profit: { kind: 'PERCENT', value: 0 },
    });
    const c = configurator.configure(product(), [
      { groupId: 'colour', valueId: 'copper' },
      { groupId: 'size', valueId: 'large' },
      { groupId: 'name', text: 'Rana' },
    ]);
    // 10 g × 2 × $0.10 = $2.00, + $2 copper + $1 text = $5.00
    expect(configurator.unitPrice(calculator, product(), c)).toBe('5.00');
  });

  describe('real sizes', () => {
    const calculator = new UnitCostCalculator({
      machineRatePerHour: 0,
      purgeWastePercent: 0,
      failureAllowancePercent: 0,
      laborCostPerUnit: 0,
      packagingCostPerUnit: 0,
      profit: { kind: 'PERCENT', value: 0 },
    });
    const size = (
      id: string,
      label: string,
      grams: number,
      isDefault = false,
    ) => ({
      id,
      productId: 'p',
      label,
      sizeXcm: D('10.0'),
      sizeYcm: D('8.0'),
      sizeZcm: D(grams / 10),
      grams: D(grams),
      printHours: D(1),
      isDefault,
      sortOrder: 0,
    });
    // Real sizes replace the old shared Size option on this product.
    const sized = (): ConfigurableProduct => ({
      ...product(),
      optionGroups: product().optionGroups.filter((g) => g.groupId !== 'size'),
      sizes: [size('s', 'Small', 10), size('l', 'Large', 40, true)],
    });

    it('offers them first, by their measurements only (names stay in the dashboard)', () => {
      const [first] = configurator.offered(sized());
      expect(first).toMatchObject({
        name: 'Size',
        kind: 'SIZE',
        required: true,
        defaultValueId: 'l',
        choices: [
          { id: 's', label: '10 × 8 × 1 cm' },
          { id: 'l', label: '10 × 8 × 4 cm' },
        ],
      });
    });

    it('prices with the grams of the chosen size; the order keeps its name and measurements', () => {
      const c = configurator.configure(sized(), [
        { groupId: PRODUCT_SIZE_GROUP_ID, valueId: 's' },
      ]);
      expect(c.chosen).toContainEqual({
        group: 'Size',
        value: '10 × 8 × 1 cm',
      });
      // 10 g × $0.10 = $1.00 (the default black adds nothing)
      expect(configurator.unitPrice(calculator, sized(), c)).toBe('1.00');
      // The default size, Large: 40 g × $0.10 = $4.00
      expect(
        configurator.unitPrice(
          calculator,
          sized(),
          configurator.starting(sized()),
        ),
      ).toBe('4.00');
    });

    it('refuses a size the product does not have', () => {
      expect(() =>
        configurator.configure(sized(), [
          { groupId: PRODUCT_SIZE_GROUP_ID, valueId: 'x' },
        ]),
      ).toThrow(BadRequestException);
    });
  });

  describe('parts customers recolour (a 3MF product)', () => {
    const calculator = new UnitCostCalculator({
      machineRatePerHour: 0,
      purgeWastePercent: 0,
      failureAllowancePercent: 0,
      laborCostPerUnit: 0,
      packagingCostPerUnit: 0,
      profit: { kind: 'PERCENT', value: 0 },
    });
    const swatch = (id: string, label: string, hex: string, extra = {}) => ({
      ...value(id, 'parts', label, { swatchHex: hex, ...extra }).value,
    });
    const colour = (
      c: string,
      hex: string,
      grams: number,
      part: string | null,
    ) => ({
      id: `${c}-row`,
      productId: 'p',
      colour: c,
      hex,
      grams: D(grams),
      part,
      startsAs: null,
      stockItemId: null,
      stockItem: null,
      sortOrder: 0,
    });
    const parted = (): ConfigurableProduct => ({
      ...product(),
      optionGroups: [],
      optionValues: [],
      colours: [
        colour('White', '#ffffff', 6, 'Body'),
        colour('Black', '#000000', 3, 'Ears'),
        colour('Grey', '#808080', 1, null),
      ],
      partColourGroupId: 'parts',
      partColourGroup: {
        ...group('parts', 'Filament colours', OptionKind.CHOICE),
        values: [
          swatch('white', 'White', '#f5f5f5'),
          swatch('black', 'Black', '#1c1c1c'),
          swatch('copper', 'Copper silk', '#b87333', { extraPrice: D(2) }),
        ],
      },
    });
    const body = partGroupId('p', '#FFFFFF');

    it('offers each named part, starting in its own colour, keyed by its file colour', () => {
      const offered = configurator.offered(parted());
      expect(
        offered.map((o) => [o.name, o.defaultValueId, o.recolours]),
      ).toEqual([
        ['Body', 'white', '#ffffff'],
        ['Ears', 'black', '#000000'],
      ]);
      expect(offered[0]!.groupId).toBe(body);
      expect(body).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      // A part's swatches never paint the model: it shows in its file's colours.
      expect(configurator.previewColor(parted())).toBeNull();
    });

    it("prices each part's colour with that colour's own add-on and records it by part", () => {
      const c = configurator.configure(parted(), [
        { groupId: body, valueId: 'copper' },
      ]);
      expect(c.chosen).toEqual([
        { group: 'Body', value: 'Copper silk' },
        { group: 'Ears', value: 'Black' },
      ]);
      // 10 g × $0.10 = $1.00, + $2 copper silk
      expect(configurator.unitPrice(calculator, parted(), c)).toBe('3.00');
      expect(
        configurator.unitPrice(
          calculator,
          parted(),
          configurator.starting(parted()),
        ),
      ).toBe('1.00');
    });

    it('refuses a colour outside the part colours', () => {
      expect(() =>
        configurator.configure(parted(), [{ groupId: body, valueId: 'red' }]),
      ).toThrow(
        new BadRequestException('This colour is not available for the Body'),
      );
    });

    it("costs each colour at its own filament's price", () => {
      const p = parted();
      // The body's 6 g from a reel bought at $0.20 a gram; the rest at the material's $0.10.
      p.colours[0] = {
        ...p.colours[0]!,
        stockItemId: 'reel',
        stockItem: {
          pricePerGram: D('0.20'),
          material: { pricePerGram: D('0.10') },
        },
      };
      // 6 × 0.20 + 4 × 0.10 = $1.60 for its 10 g.
      expect(
        configurator.unitPrice(calculator, p, configurator.starting(p)),
      ).toBe('1.60');
      // A filament without a price of its own costs what its material costs.
      p.colours[0]!.stockItem = {
        pricePerGram: null,
        material: { pricePerGram: D('0.30') },
      };
      expect(
        configurator.unitPrice(calculator, p, configurator.starting(p)),
      ).toBe('2.20');
    });

    it('offers no parts once the colour group is switched off', () => {
      const p = parted();
      p.partColourGroup!.active = false;
      expect(configurator.offered(p)).toEqual([]);
    });
  });
});
