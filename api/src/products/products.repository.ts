import { Injectable } from '@nestjs/common';
import type { ProductPrintFileView } from '@forgea/types';
import type { ProductListQuery, SaveProductDto } from '@forgea/validation';
import { keysetPage } from '../common/pagination/keyset.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { OptionKind } from '../generated/prisma/enums.js';
import { BOARD_STYLES, type TextStyle } from '@forgea/text3d/design';
import { SAMPLE_MODEL_NAMES } from '../text-studio/text-studio.service.js';
import {
  type ConfigurableProduct,
  withConfiguration,
} from './product-configurator.js';

@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The Overview's count: products in the shop without a 3D model. */
  countShownWithoutModel(): Promise<number> {
    return this.prisma.product.count({
      where: { active: true, modelFileKey: null },
    });
  }

  /** The public catalog (active only), or every product for the dashboard. */
  list(query: ProductListQuery, activeOnly: boolean) {
    const where: Prisma.ProductWhereInput = {
      ...(activeOnly
        ? { active: true }
        : query.active !== undefined
          ? { active: query.active }
          : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.material ? { material: { code: query.material } } : {}),
      ...(query.category ? { category: { slug: query.category } } : {}),
      ...(query.model === 'with'
        ? { modelFileKey: { not: null } }
        : query.model === 'without'
          ? { modelFileKey: null }
          : {}),
      ...(query.design === 'logo'
        ? { textOwnLogo: true }
        : query.design === 'yours'
          ? {
              OR: [
                { textStyle: { not: null } },
                // A slot customers may change (jsonb containment: any element with it).
                { designSlots: { array_contains: [{ editable: true }] } },
              ],
            }
          : {}),
    };
    return keysetPage<ConfigurableProduct>(
      {
        sortField: query.sort,
        kind: query.sort === 'name' ? 'string' : 'date',
        order: query.order,
        limit: query.limit,
        cursor: query.cursor,
        valueOf: (row) => row[query.sort],
      },
      ({ after, orderBy, take }) =>
        this.prisma.product.findMany({
          where: { AND: [where, after as Prisma.ProductWhereInput] },
          orderBy: orderBy as Prisma.ProductOrderByWithRelationInput[],
          take,
          include: withConfiguration,
        }),
    );
  }

  findActiveBySlug(slug: string): Promise<ConfigurableProduct | null> {
    return this.prisma.product.findFirst({
      where: { slug, active: true },
      include: withConfiguration,
    });
  }

  findActive(id: string): Promise<ConfigurableProduct | null> {
    return this.prisma.product.findFirst({
      where: { id, active: true },
      include: withConfiguration,
    });
  }

  /** The products chosen for the home page's bed, in bed order (visible, with a model). */
  plate(): Promise<ConfigurableProduct[]> {
    return this.prisma.product.findMany({
      where: {
        plateOrder: { not: null },
        active: true,
        modelFileKey: { not: null },
      },
      orderBy: { plateOrder: 'asc' },
      include: withConfiguration,
    });
  }

  /** Stand-ins while nothing is chosen: the newest visible products with a model. */
  newestWithModels(take: number): Promise<ConfigurableProduct[]> {
    return this.prisma.product.findMany({
      where: { active: true, modelFileKey: { not: null } },
      orderBy: { createdAt: 'desc' },
      take,
      include: withConfiguration,
    });
  }

  /** Replaces the bed's line-up in one transaction (positions are unique). */
  async setPlate(productIds: readonly string[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.product.updateMany({
        where: { plateOrder: { not: null } },
        data: { plateOrder: null },
      }),
      ...productIds.map((id, i) =>
        this.prisma.product.update({
          where: { id },
          data: { plateOrder: i + 1 },
        }),
      ),
    ]);
  }

  /** Every product, visible or not, oldest first (the catalog export). */
  all(): Promise<ConfigurableProduct[]> {
    return this.prisma.product.findMany({
      orderBy: { createdAt: 'asc' },
      include: withConfiguration,
    });
  }

  /** Visible or not (the dashboard and the catalog importer). */
  findBySlug(slug: string): Promise<ConfigurableProduct | null> {
    return this.prisma.product.findUnique({
      where: { slug },
      include: withConfiguration,
    });
  }

  /** How many of these values belong to the group (a personalised product's default colours). */
  valuesInGroup(groupId: string, ids: readonly string[]): Promise<number> {
    return this.prisma.optionValue.count({
      where: { groupId, id: { in: [...ids] } },
    });
  }

  /** How many switched-on colours an option group has (a personalised product's colours). */
  colourCount(groupId: string): Promise<number> {
    return this.prisma.optionValue.count({
      where: { groupId, active: true, group: { active: true } },
    });
  }

  /** Whether a model file is a generated sample (a personalised product's "Forgea"). */
  async isSampleModel(key: string): Promise<boolean> {
    return (
      (await this.prisma.upload.count({
        where: {
          storageKey: key,
          originalName: { in: [...SAMPLE_MODEL_NAMES] },
        },
      })) > 0
    );
  }

  setModel(id: string, key: string): Promise<ConfigurableProduct> {
    return this.prisma.product.update({
      where: { id },
      data: { modelFileKey: key },
      include: withConfiguration,
    });
  }

  /** A material's price per gram, for pricing a product being edited. */
  material(id: string) {
    return this.prisma.material.findUnique({
      where: { id },
      select: {
        pricePerGram: true,
        densityGPerCm3: true,
        gramsPerHour: true,
      },
    });
  }

  /** The filaments named, each with what a gram of it costs (its own price, else its material's). */
  async filaments(
    ids: readonly string[],
  ): Promise<Map<string, { pricePerGram: string }>> {
    const rows = await this.prisma.stockItem.findMany({
      where: { id: { in: [...ids] } },
      select: {
        id: true,
        pricePerGram: true,
        material: { select: { pricePerGram: true } },
      },
    });
    return new Map(
      rows.map((f) => [
        f.id,
        {
          pricePerGram: (f.pricePerGram ?? f.material.pricePerGram).toString(),
        },
      ]),
    );
  }

  /** A group parts are recoloured from: its switched-on colours that have a swatch. */
  partColours(groupId: string) {
    return this.prisma.optionGroup.findFirst({
      where: { id: groupId, active: true, kind: OptionKind.CHOICE },
      select: {
        values: {
          where: { active: true, swatchHex: { not: null } },
          select: { label: true },
        },
      },
    });
  }

  /** The shop's colours (option values with a swatch, switched on), for matching a file's. */
  async swatches(): Promise<{ label: string; swatchHex: string }[]> {
    const values = await this.prisma.optionValue.findMany({
      where: {
        active: true,
        swatchHex: { not: null },
        group: { active: true },
      },
      select: { label: true, swatchHex: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
    return values.flatMap((v) =>
      v.swatchHex ? [{ label: v.label, swatchHex: v.swatchHex }] : [],
    );
  }

  findById(id: string): Promise<ConfigurableProduct | null> {
    return this.prisma.product.findUnique({
      where: { id },
      include: withConfiguration,
    });
  }

  /** The groups' kinds and values, to check a product's option set-up before saving it. */
  optionGroups(ids: readonly string[]) {
    return this.prisma.optionGroup.findMany({
      where: { id: { in: [...ids] } },
      select: {
        id: true,
        name: true,
        kind: true,
        values: { select: { id: true, materialId: true } },
      },
    });
  }

  create(
    dto: SaveProductDto,
    slicedFile: boolean,
    printFiles: readonly ProductPrintFileView[],
  ): Promise<ConfigurableProduct> {
    return this.prisma.product.create({
      data: {
        ...fields(dto),
        slicedFile,
        printFiles: { create: printFiles.map(printFileRow) },
        ...optionRows(dto),
        sizes: { create: dto.sizes.map(sizeRow) },
        colours: { create: dto.colours.map(colourRow) },
        extraCosts: { create: dto.extraCosts.map(extraCostRow) },
      },
      include: withConfiguration,
    });
  }

  /** Replaces the product's fields and its whole option set-up in one transaction. */
  update(
    id: string,
    dto: SaveProductDto,
    slicedFile: boolean,
    printFiles: readonly ProductPrintFileView[],
  ): Promise<ConfigurableProduct> {
    return this.prisma.$transaction(async (tx) => {
      await tx.productPrintFile.deleteMany({ where: { productId: id } });
      await tx.productOptionValue.deleteMany({ where: { productId: id } });
      await tx.productOptionGroup.deleteMany({ where: { productId: id } });
      await tx.productColour.deleteMany({ where: { productId: id } });
      await tx.productExtraCost.deleteMany({ where: { productId: id } });
      // Sizes keep their ids (matched by name), so carts holding one still find it.
      const labels = dto.sizes.map((s) => s.label);
      await tx.productSize.deleteMany({
        where: { productId: id, label: { notIn: labels } },
      });
      await tx.productSize.updateMany({
        where: { productId: id },
        data: { isDefault: false },
      });
      for (const [i, size] of dto.sizes.entries()) {
        await tx.productSize.upsert({
          where: { productId_label: { productId: id, label: size.label } },
          create: { productId: id, ...sizeRow(size, i) },
          update: sizeRow(size, i),
        });
      }
      return tx.product.update({
        where: { id },
        data: {
          ...fields(dto),
          slicedFile,
          ...optionRows(dto),
          colours: { create: dto.colours.map(colourRow) },
          printFiles: { create: printFiles.map(printFileRow) },
          extraCosts: { create: dto.extraCosts.map(extraCostRow) },
        },
        include: withConfiguration,
      });
    });
  }
}

const extraCostRow = (
  e: SaveProductDto['extraCosts'][number],
  sortOrder: number,
) => ({ label: e.label, amount: e.amount, sortOrder });

const fields = (dto: SaveProductDto) => ({
  slug: dto.slug,
  name: dto.name,
  description: dto.description,
  categoryId: dto.categoryId ?? null,
  materialId: dto.materialId,
  grams: dto.grams,
  printHours: dto.printHours,
  isCustom: dto.isCustom,
  designer: dto.designer ?? null,
  active: dto.active,
  studioOnly: dto.studioOnly ?? false,
  modelFileKey: dto.modelFileKey ?? null,
  imageKeys: dto.imageKeys,
  sizeXcm: dto.sizeXcm ?? null,
  sizeYcm: dto.sizeYcm ?? null,
  sizeZcm: dto.sizeZcm ?? null,
  // Personalised text: all its settings, or none (a regular product).
  textStyle: dto.text?.style ?? null,
  textMaxChars: dto.text?.maxChars ?? null,
  textHeightMm: dto.text?.letterHeightMm ?? null,
  textDepthMm: dto.text?.letterDepthMm ?? null,
  textBaseMm: dto.text?.baseDepthMm ?? null,
  textMaxWidthMm: dto.text?.maxWidthMm ?? null,
  textColourGroupId: dto.text?.colourGroupId ?? null,
  textExtraColourPrice: dto.text?.extraColourPrice ?? '0',
  textSizesMm: dto.text?.sizesMm ?? [],
  textDefaultColourId: dto.text?.defaultColourId ?? null,
  textDefaultBaseId: dto.text?.defaultBaseColourId ?? null,
  textDefaultAccentId: dto.text?.defaultAccentColourId ?? null,
  // Decorations belong to a big initial only (CHECK).
  textDecor:
    dto.text?.style === 'INITIAL_NAME' ? (dto.text.decor ?? null) : null,
  // Shapes belong to name keychains; logos to them and to pieces designed freely.
  textShapes: dto.text?.style === 'KEYCHAIN' ? dto.text.shapes : [],
  textLogoIds: takesLogos(dto.text?.style) ? dto.text!.logoIds : [],
  textOwnLogo: takesLogos(dto.text?.style)
    ? (dto.text!.ownLogo ?? false)
    : false,
  profitKind: dto.profitKind ?? null,
  profitValue: dto.profitKind ? (dto.profitValue ?? null) : null,
  priceOverride: dto.priceOverride ?? null,
  // Kept only while a part is recoloured by customers, or text and logos print in its colours.
  partColourGroupId:
    dto.colours.some((c) => c.part) || dto.slots.length > 0
      ? (dto.partColourGroupId ?? null)
      : null,
  // As checked by DesignSlots.check (ProductsService).
  designSlots: dto.slots as unknown as Prisma.InputJsonValue,
});

const printFileRow = (f: ProductPrintFileView, sortOrder: number) => ({
  fileKey: f.fileKey,
  name: f.name,
  grams: f.grams,
  printHours: f.printHours,
  // The API's own snapshot of the file: plain data.
  details: {
    colours: f.colours,
    setup: { ...f.setup },
  } as Prisma.InputJsonObject,
  sortOrder,
});

const colourRow = (
  c: SaveProductDto['colours'][number],
  sortOrder: number,
) => ({
  colour: c.colour,
  hex: c.hex,
  grams: c.grams,
  part: c.part || null,
  // Only a part starts somewhere.
  startsAs: (c.part && c.startsAs) || null,
  stockItemId: c.stockItemId ?? null,
  sortOrder,
});

const sizeRow = (s: SaveProductDto['sizes'][number], sortOrder: number) => ({
  label: s.label,
  sizeXcm: s.sizeXcm,
  sizeYcm: s.sizeYcm,
  sizeZcm: s.sizeZcm,
  grams: s.grams,
  printHours: s.printHours,
  isDefault: s.isDefault,
  sortOrder,
});

const optionRows = (dto: SaveProductDto) => ({
  optionGroups: {
    create: dto.options.map((o, sortOrder) => ({
      groupId: o.groupId,
      required: o.required,
      sortOrder,
    })),
  },
  optionValues: {
    create: dto.options.flatMap((o) =>
      o.valueIds.map((valueId) => ({
        valueId,
        isDefault: valueId === o.defaultValueId,
      })),
    ),
  },
});

/** Name keychains and pieces designed freely offer logos (the studio's, or the customer's). */
function takesLogos(style: TextStyle | undefined): boolean {
  return (
    style === 'KEYCHAIN' ||
    (style !== undefined && BOARD_STYLES.includes(style))
  );
}
