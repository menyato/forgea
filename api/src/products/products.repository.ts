import { Injectable } from '@nestjs/common';
import type { ProductListQuery, SaveProductDto } from '@forgea/validation';
import { keysetPage } from '../common/pagination/keyset.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
  type ConfigurableProduct,
  withConfiguration,
} from './product-configurator.js';

@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The public catalog (active only), or every product for the dashboard. */
  list(query: ProductListQuery, activeOnly: boolean) {
    const where: Prisma.ProductWhereInput = {
      ...(activeOnly ? { active: true } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.material ? { material: { code: query.material } } : {}),
      ...(query.category ? { category: { slug: query.category } } : {}),
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

  create(dto: SaveProductDto): Promise<ConfigurableProduct> {
    return this.prisma.product.create({
      data: { ...fields(dto), ...optionRows(dto) },
      include: withConfiguration,
    });
  }

  /** Replaces the product's fields and its whole option set-up in one transaction. */
  update(id: string, dto: SaveProductDto): Promise<ConfigurableProduct> {
    return this.prisma.$transaction(async (tx) => {
      await tx.productOptionValue.deleteMany({ where: { productId: id } });
      await tx.productOptionGroup.deleteMany({ where: { productId: id } });
      return tx.product.update({
        where: { id },
        data: { ...fields(dto), ...optionRows(dto) },
        include: withConfiguration,
      });
    });
  }
}

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
  modelFileKey: dto.modelFileKey ?? null,
  imageKeys: dto.imageKeys,
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
