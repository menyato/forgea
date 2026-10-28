import { BadRequestException } from '@nestjs/common';
import { UnitCostCalculator } from '@forgea/pricing';
import { Prisma } from '../generated/prisma/client.js';
import { OptionKind } from '../generated/prisma/enums.js';
import {
  type ConfigurableProduct,
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
    material: { code: 'PLA', name: 'PLA', pricePerGram: D('0.10') },
    isCustom: false,
    designer: null,
    active: true,
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
      markupMultiplier: 1,
    });
    const c = configurator.configure(product(), [
      { groupId: 'colour', valueId: 'copper' },
      { groupId: 'size', valueId: 'large' },
      { groupId: 'name', text: 'Rana' },
    ]);
    // 10 g × 2 × $0.10 = $2.00, + $2 copper + $1 text = $5.00
    expect(configurator.unitPrice(calculator, product(), c)).toBe('5.00');
  });
});
