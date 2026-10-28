import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AdminProduct,
  AdminProductListItem,
  HomePlate,
  OptionSelection,
  Page,
  ProductDetail,
  ProductListItem,
} from '@forgea/types';
import type { ProductListQuery, SaveProductDto } from '@forgea/validation';
import { toPage } from '../common/pagination/keyset.js';
import { OptionKind, UploadPurpose } from '../generated/prisma/enums.js';
import { PricingService } from '../pricing/pricing.service.js';
import { UploadsService } from '../uploads/uploads.service.js';
import {
  type ConfigurableProduct,
  ProductConfigurator,
} from './product-configurator.js';
import { ProductsRepository } from './products.repository.js';

/** The home page's bed: a centre and four corners. */
const PLATE_SIZE = 5;

@Injectable()
export class ProductsService {
  constructor(
    private readonly products: ProductsRepository,
    private readonly pricing: PricingService,
    private readonly configurator: ProductConfigurator,
    private readonly uploads: UploadsService,
  ) {}

  /** The public catalog, each product priced by the engine (cost inputs never leave the API). */
  async list(query: ProductListQuery): Promise<Page<ProductListItem>> {
    const [page, calculator] = await Promise.all([
      this.products.list(query, true),
      this.pricing.costCalculator(),
    ]);
    return toPage(page, (p) => ({
      ...this.summary(p),
      price: this.configurator.unitPrice(
        calculator,
        p,
        this.configurator.starting(p),
      ),
    }));
  }

  /** The home page's bed: the owner's choice, or the newest models until there is one. */
  async plate(): Promise<HomePlate> {
    const chosen = await this.products.plate();
    const products =
      chosen.length > 0
        ? chosen
        : await this.products.newestWithModels(PLATE_SIZE);
    const calculator = await this.pricing.costCalculator();
    return {
      chosen: chosen.length > 0,
      products: products.map((p) => ({
        ...this.summary(p),
        price: this.configurator.unitPrice(
          calculator,
          p,
          this.configurator.starting(p),
        ),
      })),
    };
  }

  /** Only products with a 3D model can stand on the bed. */
  async setPlate(productIds: readonly string[]): Promise<HomePlate> {
    for (const id of productIds) {
      const p = await this.products.findById(id);
      if (!p) throw new NotFoundException('Product not found');
      if (!p.modelFileKey) {
        throw new BadRequestException(
          `"${p.name}" has no 3D model to show on the bed`,
        );
      }
    }
    await this.products.setPlate(productIds);
    return this.plate();
  }

  /** A product page: the options to choose, the 3D model, the starting price. */
  async detail(slug: string): Promise<ProductDetail> {
    const p = await this.products.findActiveBySlug(slug);
    if (!p) throw new NotFoundException('Product not found');
    const calculator = await this.pricing.costCalculator();
    return {
      ...this.summary(p),
      price: this.configurator.unitPrice(
        calculator,
        p,
        this.configurator.starting(p),
      ),
      isCustom: p.isCustom,
      designer: p.designer,
      imageKeys: p.imageKeys,
      options: this.configurator.offered(p),
    };
  }

  /** The unit price for exactly these choices, as the product page updates it live. */
  async price(
    slug: string,
    selections: readonly OptionSelection[],
  ): Promise<{ unitPrice: string }> {
    const p = await this.products.findActiveBySlug(slug);
    if (!p) throw new NotFoundException('Product not found');
    const configuration = this.configurator.configure(p, selections);
    return {
      unitPrice: this.configurator.unitPrice(
        await this.pricing.costCalculator(),
        p,
        configuration,
      ),
    };
  }

  // Dashboard

  async manageList(
    query: ProductListQuery,
  ): Promise<Page<AdminProductListItem>> {
    const [page, calculator] = await Promise.all([
      this.products.list(query, false),
      this.pricing.costCalculator(),
    ]);
    return toPage(page, (p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      category: p.category?.name ?? null,
      material: p.material.code,
      price: this.configurator.unitPrice(
        calculator,
        p,
        this.configurator.starting(p),
      ),
      active: p.active,
      hasModel: p.modelFileKey !== null,
      updatedAt: p.updatedAt.toISOString(),
    }));
  }

  async manageOne(id: string): Promise<AdminProduct> {
    const p = await this.products.findById(id);
    if (!p) throw new NotFoundException('Product not found');
    return this.toAdmin(p);
  }

  /** Null when no product has this address (visible or not). */
  async manageBySlug(slug: string): Promise<AdminProduct | null> {
    const p = await this.products.findBySlug(slug);
    return p ? this.toAdmin(p) : null;
  }

  async create(dto: SaveProductDto): Promise<AdminProduct> {
    await this.checkSetup(dto);
    return this.toAdmin(await this.products.create(dto));
  }

  async update(id: string, dto: SaveProductDto): Promise<AdminProduct> {
    await this.checkSetup(dto);
    return this.toAdmin(await this.products.update(id, dto));
  }

  /**
   * Refuses a set-up the shop couldn't sell: files that aren't accepted uploads, values from
   * another group, a default that isn't offered, a choice group with no choices, or two
   * options that would each switch the material.
   */
  private async checkSetup(dto: SaveProductDto): Promise<void> {
    if (dto.modelFileKey) {
      await this.uploads.requireClean(
        [dto.modelFileKey],
        UploadPurpose.PRODUCT_MODEL,
      );
    }
    await this.uploads.requireClean(dto.imageKeys, UploadPurpose.PRODUCT_IMAGE);

    const ids = dto.options.map((o) => o.groupId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('An option group is listed twice');
    }
    const groups = new Map(
      (await this.products.optionGroups(ids)).map((g) => [g.id, g]),
    );
    let materialGroups = 0;
    for (const o of dto.options) {
      const group = groups.get(o.groupId);
      if (!group) throw new BadRequestException('Unknown option group');
      if (group.kind === OptionKind.TEXT) {
        if (o.valueIds.length > 0 || o.defaultValueId) {
          throw new BadRequestException(`${group.name} is a text option`);
        }
        continue;
      }
      const own = new Map(group.values.map((v) => [v.id, v]));
      if (o.valueIds.length === 0) {
        throw new BadRequestException(`Pick at least one ${group.name}`);
      }
      if (o.valueIds.some((id) => !own.has(id))) {
        throw new BadRequestException(
          `A value does not belong to ${group.name}`,
        );
      }
      if (o.defaultValueId && !o.valueIds.includes(o.defaultValueId)) {
        throw new BadRequestException(
          `The default ${group.name} must be one of the offered values`,
        );
      }
      if (o.valueIds.some((id) => own.get(id)?.materialId)) materialGroups++;
    }
    if (materialGroups > 1) {
      throw new BadRequestException('Only one option can change the material');
    }
  }

  private async toAdmin(p: ConfigurableProduct): Promise<AdminProduct> {
    const calculator = await this.pricing.costCalculator();
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      categoryId: p.categoryId,
      materialId: p.materialId,
      grams: p.grams.toString(),
      printHours: p.printHours.toString(),
      isCustom: p.isCustom,
      designer: p.designer,
      active: p.active,
      modelFileKey: p.modelFileKey,
      imageKeys: p.imageKeys,
      options: p.optionGroups.map((pg) => {
        const values = p.optionValues.filter(
          (v) => v.value.groupId === pg.groupId,
        );
        return {
          groupId: pg.groupId,
          required: pg.required,
          valueIds: values.map((v) => v.valueId),
          defaultValueId: values.find((v) => v.isDefault)?.valueId ?? null,
        };
      }),
      price: this.configurator.unitPrice(
        calculator,
        p,
        this.configurator.starting(p),
      ),
    };
  }

  private summary(p: ConfigurableProduct) {
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      material: { code: p.material.code, name: p.material.name },
      category: p.category,
      hasOptions: this.configurator.offered(p).length > 0,
      modelKey: p.modelFileKey,
      previewColor: this.configurator.previewColor(p),
      createdAt: p.createdAt.toISOString(),
    };
  }
}
