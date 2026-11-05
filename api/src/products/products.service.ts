import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PricingError } from '@forgea/pricing';
import type {
  AdminProduct,
  AdminProductListItem,
  HomePlate,
  OptionSelection,
  Page,
  PricePreview,
  ProductDetail,
  ProductListItem,
  DesignMeasurement,
  TextDesignInput,
} from '@forgea/types';
import type {
  PricePreviewDto,
  ProductListQuery,
  SaveProductDto,
} from '@forgea/validation';
import { toPage } from '../common/pagination/keyset.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  OptionKind,
  ProfitKind,
  UploadPurpose,
} from '../generated/prisma/enums.js';
import { PricingService } from '../pricing/pricing.service.js';
import { TextStudio } from '../text-studio/text-studio.service.js';
import { UploadsService } from '../uploads/uploads.service.js';
import {
  type ConfigurableProduct,
  ProductConfigurator,
  profitOf,
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
    private readonly studio: TextStudio,
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
      // One size only: show its measurements; with sizes, each choice shows its own.
      size: p.sizes.length === 0 ? productSize(p) : null,
      text: await this.studio.offer(p),
    };
  }

  /** The unit price for exactly these choices, as the product page updates it live. */
  async price(
    slug: string,
    selections: readonly OptionSelection[],
    design?: TextDesignInput,
    measured?: DesignMeasurement,
  ): Promise<{ unitPrice: string }> {
    const p = await this.products.findActiveBySlug(slug);
    if (!p) throw new NotFoundException('Product not found');
    // Like the cart: a design only for a product that has one.
    if (design && !p.textStyle)
      throw new BadRequestException('This product has no text to design');
    const configuration = this.configurator.configure(p, selections);
    // A personalised piece: priced by what it takes, as the browser measured it (or, when it
    // sent no measurement, as the worker does).
    if (p.textStyle && design) {
      const measurement = await this.studio.measure(p, design, measured);
      return {
        unitPrice: this.studio.price(
          await this.pricing.costCalculator(),
          p,
          measurement,
        ),
      };
    }
    return {
      unitPrice: this.configurator.unitPrice(
        await this.pricing.costCalculator(),
        p,
        configuration,
      ),
    };
  }

  // Dashboard

  async manageCounts(): Promise<{ shownWithoutModel: number }> {
    return { shownWithoutModel: await this.products.countShownWithoutModel() };
  }

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

  /** `mayPrice`: the caller manages pricing; only they may give a product its own profit. */
  async create(dto: SaveProductDto, mayPrice: boolean): Promise<AdminProduct> {
    if (!mayPrice && dto.profitKind !== undefined) throw profitNotYours();
    await this.checkSetup(dto);
    return this.toAdmin(await this.withSample(await this.products.create(dto)));
  }

  async update(
    id: string,
    dto: SaveProductDto,
    mayPrice: boolean,
  ): Promise<AdminProduct> {
    if (!mayPrice) {
      // Anyone editing the catalog keeps the product's profit rule as it is.
      const current = await this.products.findById(id);
      if (!current) throw new NotFoundException('Product not found');
      const now = profitOf(current);
      const asked =
        dto.profitKind !== undefined && dto.profitValue !== undefined
          ? { kind: dto.profitKind, value: dto.profitValue }
          : null;
      if (
        now?.kind !== asked?.kind ||
        (now && asked && !new Prisma.Decimal(now.value).eq(asked.value))
      ) {
        throw profitNotYours();
      }
    }
    await this.checkSetup(dto);
    return this.toAdmin(
      await this.withSample(await this.products.update(id, dto)),
    );
  }

  /**
   * What a product being edited would sell at. The cost breakdown only for whoever manages
   * pricing (it shows the studio's costs); everyone else sees the price.
   */
  async pricePreview(
    dto: PricePreviewDto,
    mayPrice: boolean,
  ): Promise<PricePreview> {
    const material = await this.products.material(dto.materialId);
    if (!material) throw new BadRequestException('Choose a material');
    const profit =
      dto.profitKind !== undefined && dto.profitValue !== undefined
        ? { kind: dto.profitKind, value: dto.profitValue }
        : null;
    let b;
    try {
      b = (await this.pricing.costCalculator()).price(
        {
          grams: dto.grams,
          printHours: dto.printHours,
          pricePerGram: material.pricePerGram.toString(),
        },
        profit,
      );
    } catch (error) {
      if (error instanceof PricingError)
        throw new BadRequestException(error.message);
      throw error;
    }
    return {
      unitPrice: b.unitPrice,
      breakdown: mayPrice
        ? {
            material: b.materialCost,
            printer: b.machineCost,
            wasteAndFailures: new Prisma.Decimal(b.wasteCost)
              .plus(b.failureAllowance)
              .toFixed(2),
            labour: b.laborCost,
            packaging: b.packagingCost,
            cost: b.subtotal,
            profit: b.profit,
            profitRule: b.profitRule,
          }
        : null,
    };
  }

  /**
   * Refuses a set-up the shop couldn't sell: files that aren't accepted uploads, values from
   * another group, a default that isn't offered, a choice group with no choices, or two
   * options that would each switch the material.
   */
  /**
   * A personalised product without a model of its own shows "Forgea" made in its style (its
   * cards, thumbnails, the home page bed), made again when its settings change. A model the
   * owner uploaded is never replaced; a sample that can't be made leaves the product as it is.
   */
  private async withSample(
    p: ConfigurableProduct,
  ): Promise<ConfigurableProduct> {
    if (!p.textStyle) return p;
    if (p.modelFileKey && !(await this.products.isSampleModel(p.modelFileKey)))
      return p;
    const key = await this.studio.sampleModel(p).catch(() => null);
    if (!key || key === p.modelFileKey) return p;
    return this.products.setModel(p.id, key);
  }

  private async checkSetup(dto: SaveProductDto): Promise<void> {
    if (dto.text) {
      if (dto.text.style === 'MONOGRAM' && dto.text.maxChars > 3)
        throw new BadRequestException('Curved initials take up to 3 letters');
      if (dto.text.style === 'INITIAL_NAME' && !dto.text.decor)
        throw new BadRequestException(
          'Choose the decorations around the initial',
        );
      const defaults = [
        ...new Set(
          [
            dto.text.defaultColourId,
            dto.text.defaultBaseColourId,
            dto.text.defaultAccentColourId,
          ].filter((id): id is string => id !== undefined),
        ),
      ];
      if (
        defaults.length &&
        (await this.products.valuesInGroup(
          dto.text.colourGroupId,
          defaults,
        )) !== defaults.length
      )
        throw new BadRequestException(
          'The starting colours must come from the colour group chosen',
        );
      if ((await this.products.colourCount(dto.text.colourGroupId)) === 0)
        throw new BadRequestException(
          'Choose a colour group with at least one colour switched on',
        );
    }
    if (
      dto.profitKind === ProfitKind.PERCENT &&
      new Prisma.Decimal(dto.profitValue ?? '0').gt(1000)
    ) {
      throw new BadRequestException('A profit can be at most 1000%');
    }
    const measured = [dto.sizeXcm, dto.sizeYcm, dto.sizeZcm].filter(Boolean);
    if (measured.length % 3 !== 0) {
      throw new BadRequestException(
        'Give all three measurements (width, depth, height) or none',
      );
    }
    const labels = dto.sizes.map((s) => s.label.toLowerCase());
    if (new Set(labels).size !== labels.length) {
      throw new BadRequestException('Two sizes have the same name');
    }
    // Customers tell sizes apart by their measurements alone.
    const measures = dto.sizes.map(
      (s) => `${Number(s.sizeXcm)}×${Number(s.sizeYcm)}×${Number(s.sizeZcm)}`,
    );
    if (new Set(measures).size !== measures.length) {
      throw new BadRequestException('Two sizes have the same measurements');
    }
    if (dto.sizes.filter((s) => s.isDefault).length > 1) {
      throw new BadRequestException('Only one size can be the default');
    }
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
      text: this.studio.settingsView(p),
      profit: profitOf(p),
      size: productSize(p),
      sizes: p.sizes.map((s) => ({
        id: s.id,
        label: s.label,
        size: {
          x: s.sizeXcm.toString(),
          y: s.sizeYcm.toString(),
          z: s.sizeZcm.toString(),
        },
        grams: s.grams.toString(),
        printHours: s.printHours.toString(),
        isDefault: s.isDefault,
      })),
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
      hasOptions:
        this.configurator.offered(p).length > 0 || p.textStyle !== null,
      personalised: p.textStyle !== null,
      modelKey: p.modelFileKey,
      // A personalised piece shows in the colour its letters start in.
      previewColor: p.textStyle
        ? ((
            p.textColourGroup?.values.find(
              (v) => v.id === p.textDefaultColourId,
            ) ?? p.textColourGroup?.values[0]
          )?.swatchHex ?? null)
        : this.configurator.previewColor(p),
      createdAt: p.createdAt.toISOString(),
    };
  }
}

/** The size grams and printHours are for, when it was measured. */
function productSize(p: ConfigurableProduct) {
  return p.sizeXcm && p.sizeYcm && p.sizeZcm
    ? {
        x: p.sizeXcm.toString(),
        y: p.sizeYcm.toString(),
        z: p.sizeZcm.toString(),
      }
    : null;
}

const profitNotYours = () =>
  new ForbiddenException(
    "Only someone who manages pricing can change a product's profit",
  );
