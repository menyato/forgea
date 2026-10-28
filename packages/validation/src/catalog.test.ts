import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  AddCartItemDto,
  SaveCategoryDto,
  SaveMaterialDto,
  SaveOptionGroupDto,
  SaveOptionValueDto,
  SaveProductDto,
} from './index.js';

/** Same options as the API's global ValidationPipe; nested errors are reported by path. */
function check<T extends object>(cls: new () => T, plain: object) {
  const dto = plainToInstance(cls, plain);
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const fields = errors.flatMap((e) =>
    e.children?.length
      ? e.children.flatMap((c) =>
          (c.children ?? []).map(
            (g) => `${e.property}.${c.property}.${g.property}`,
          ),
        )
      : [e.property],
  );
  return { dto, fields };
}

const uuid = '0192f3a4-5b6c-7d8e-9f01-23456789abcd';

describe('SaveCategoryDto', () => {
  it('accepts a category and fills defaults', () => {
    const { dto, fields } = check(SaveCategoryDto, {
      slug: 'home-desk',
      name: ' Home & desk ',
    });
    expect(fields).toEqual([]);
    expect(dto).toMatchObject({
      name: 'Home & desk',
      sortOrder: 0,
      active: true,
    });
  });

  it.each(['Home Desk', 'home--desk', '-home', 'home_desk'])(
    'rejects the slug %j',
    (slug) => {
      expect(check(SaveCategoryDto, { slug, name: 'Home' }).fields).toEqual([
        'slug',
      ]);
    },
  );
});

describe('SaveMaterialDto', () => {
  const pla = {
    code: 'PLA',
    name: 'PLA',
    pricePerGram: '0.035',
    densityGPerCm3: '1.24',
    gramsPerHour: '12',
    stockGrams: '5000',
    lowStockThresholdGrams: 1000,
    active: true,
  };

  it('accepts a material, converting form numbers', () => {
    const { dto, fields } = check(SaveMaterialDto, pla);
    expect(fields).toEqual([]);
    expect(dto.stockGrams).toBe(5000);
  });

  it('rejects a zero density or throughput and a lowercase code', () => {
    expect(
      check(SaveMaterialDto, {
        ...pla,
        code: 'pla',
        densityGPerCm3: '0',
        gramsPerHour: '0.0',
      }).fields,
    ).toEqual(['code', 'densityGPerCm3', 'gramsPerHour']);
  });
});

describe('SaveOptionGroupDto', () => {
  it('needs a max length for text options only', () => {
    expect(
      check(SaveOptionGroupDto, { name: 'Colour', kind: 'CHOICE' }).fields,
    ).toEqual([]);
    expect(
      check(SaveOptionGroupDto, { name: 'Name', kind: 'TEXT' }).fields,
    ).toEqual(['maxLength']);
    expect(
      check(SaveOptionGroupDto, {
        name: 'Name',
        kind: 'TEXT',
        maxLength: '12',
        textExtraPrice: '1.50',
      }).fields,
    ).toEqual([]);
    expect(
      check(SaveOptionGroupDto, { name: 'Name', kind: 'LIST' }).fields,
    ).toEqual(['kind']);
  });
});

describe('SaveOptionValueDto', () => {
  it('defaults to "no effect on price"', () => {
    const { dto, fields } = check(SaveOptionValueDto, {
      label: 'Black',
      swatchHex: '#111111',
    });
    expect(fields).toEqual([]);
    expect(dto).toMatchObject({
      gramsMultiplier: '1',
      hoursMultiplier: '1',
      extraPrice: '0',
    });
  });

  it('rejects zero multipliers, negative add-ons and odd colours', () => {
    expect(
      check(SaveOptionValueDto, {
        label: 'Large',
        gramsMultiplier: '0',
        extraPrice: '-1',
        swatchHex: 'red',
      }).fields,
    ).toEqual(['swatchHex', 'gramsMultiplier', 'extraPrice']);
  });
});

describe('SaveProductDto', () => {
  const product = {
    slug: 'phone-stand',
    name: 'Phone stand',
    description: 'A weighted stand with a cable channel.',
    materialId: uuid,
    grams: '60',
    printHours: '3',
    isCustom: false,
    active: true,
  };

  it('accepts a product with its options and files', () => {
    const { fields } = check(SaveProductDto, {
      ...product,
      modelFileKey: `clean/${uuid}.stl`,
      imageKeys: [`clean/${uuid}.webp`],
      options: [
        {
          groupId: uuid,
          required: true,
          valueIds: [uuid],
          defaultValueId: uuid,
        },
      ],
    });
    expect(fields).toEqual([]);
  });

  it('accepts only keys of accepted uploads, never URLs or quarantined files', () => {
    expect(
      check(SaveProductDto, {
        ...product,
        modelFileKey: 'https://evil.example/x.stl',
      }).fields,
    ).toEqual(['modelFileKey']);
    expect(
      check(SaveProductDto, { ...product, imageKeys: [`quarantine/${uuid}`] })
        .fields,
    ).toEqual(['imageKeys']);
  });

  it('validates each option row', () => {
    expect(
      check(SaveProductDto, {
        ...product,
        options: [{ groupId: 'x', required: 'yes', valueIds: [] }],
      }).fields,
    ).toEqual(['options.0.groupId', 'options.0.required']);
  });
});

describe('AddCartItemDto options', () => {
  it('accepts chosen values and typed text, trimmed', () => {
    const { dto, fields } = check(AddCartItemDto, {
      productId: uuid,
      options: [
        { groupId: uuid, valueId: uuid },
        { groupId: uuid, text: '  Rana ' },
      ],
    });
    expect(fields).toEqual([]);
    expect(dto.options[1]?.text).toBe('Rana');
  });
});
