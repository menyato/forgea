import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { averagePricePerGram, PricingError } from '@forgea/pricing';
import type {
  AdminProduct,
  AdminProductListItem,
  HomePlate,
  OptionSelection,
  Page,
  PricePreview,
  PrintFilesTotal,
  PrintSetup,
  ProductDetail,
  ProductListItem,
  ProductPrintFileView,
  QuotableProduct,
  QuotableSize,
  DesignMeasurement,
  TextDesignInput,
} from '@forgea/types';
import type {
  PricePreviewDto,
  PrintFilesDto,
  ProductListQuery,
  SaveProductDto,
  SlotChoiceDto,
} from '@forgea/validation';
import {
  formatSizeCm,
  PRODUCT_SIZE_GROUP_ID,
  shownColours,
} from '@forgea/types';
import { toPage } from '../common/pagination/keyset.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  OptionKind,
  ProfitKind,
  UploadPurpose,
} from '../generated/prisma/enums.js';
import { PricingService } from '../pricing/pricing.service.js';
import { DesignSlots } from '../text-studio/design-slots.js';
import { TextStudio } from '../text-studio/text-studio.service.js';
import { UploadsService } from '../uploads/uploads.service.js';
import {
  type ConfigurableProduct,
  extraCostOf,
  ProductConfigurator,
  profitOf,
  type Configuration,
} from './product-configurator.js';
import { ModelFileInfoService } from './model-file-info.js';
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
    private readonly files: ModelFileInfoService,
    private readonly slots: DesignSlots,
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
      slots: await this.slots.offer(p),
    };
  }

  /** The unit price for exactly these choices, as the product page updates it live. */
  async price(
    slug: string,
    selections: readonly OptionSelection[],
    design?: TextDesignInput,
    measured?: DesignMeasurement,
    slotChoices: readonly SlotChoiceDto[] = [],
  ): Promise<{ unitPrice: string }> {
    const p = await this.products.findActiveBySlug(slug);
    if (!p) throw new NotFoundException('Product not found');
    // Like the cart: a design only for a product that has one.
    if (design && !p.textStyle)
      throw new BadRequestException('This product has no text to design');
    const configuration = withSlots(
      this.configurator.configure(p, selections),
      await this.slots.measure(p, slotChoices),
    );
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
      modelKey: p.modelFileKey,
      previewColor: this.summary(p).previewColor,
      colours: shownColours(
        p.colours,
        p.partColourGroup?.active ? p.partColourGroup.values : null,
      ),
      updatedAt: p.updatedAt.toISOString(),
    }));
  }

  /** `mayPrice`: the caller manages pricing; others don't get its profit, price or extra costs. */
  async manageOne(id: string, mayPrice: boolean): Promise<AdminProduct> {
    const p = await this.products.findById(id);
    if (!p) throw new NotFoundException('Product not found');
    return this.toAdmin(p, mayPrice);
  }

  /** Null when no product has this address (visible or not). */
  async manageBySlug(slug: string): Promise<AdminProduct | null> {
    const p = await this.products.findBySlug(slug);
    return p ? this.toAdmin(p) : null;
  }

  /** `mayPrice`: the caller manages pricing; only they may give a product its own profit. */
  async create(dto: SaveProductDto, mayPrice: boolean): Promise<AdminProduct> {
    if (
      !mayPrice &&
      (dto.profitKind !== undefined ||
        dto.priceOverride !== undefined ||
        dto.extraCosts.length > 0)
    )
      throw profitNotYours();
    dto = await this.checkSetup(dto);
    return this.toAdmin(
      await this.withSample(
        await this.products.create(
          dto,
          await this.slicedFile(dto),
          await this.printFilesOf(dto),
        ),
      ),
      mayPrice,
    );
  }

  async update(
    id: string,
    dto: SaveProductDto,
    mayPrice: boolean,
  ): Promise<AdminProduct> {
    if (!mayPrice) {
      // Anyone editing the catalog keeps the product's profit rule as it is. They are not
      // shown it, so a save that says nothing about it means "as it is".
      const current = await this.products.findById(id);
      if (!current) throw new NotFoundException('Product not found');
      const now = profitOf(current);
      if (
        dto.profitKind === undefined &&
        dto.priceOverride === undefined &&
        dto.extraCosts.length === 0
      ) {
        dto = {
          ...dto,
          ...(now ? { profitKind: now.kind, profitValue: now.value } : {}),
          ...(current.priceOverride
            ? { priceOverride: current.priceOverride.toFixed(2) }
            : {}),
          extraCosts: current.extraCosts.map((e) => ({
            label: e.label,
            amount: e.amount.toFixed(2),
          })),
        };
      }
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
      // Their own price too.
      const price = current.priceOverride;
      if (
        (price === null) !== (dto.priceOverride === undefined) ||
        (price !== null && !price.eq(dto.priceOverride!))
      ) {
        throw profitNotYours();
      }
      // And its extra costs.
      const same = (a: { label: string; amount: { toString(): string } }[]) =>
        a
          .map(
            (e) =>
              `${e.label}=${new Prisma.Decimal(e.amount.toString()).toFixed(2)}`,
          )
          .join('|');
      if (same(current.extraCosts) !== same(dto.extraCosts))
        throw profitNotYours();
    }
    dto = await this.checkSetup(dto);
    return this.toAdmin(
      await this.withSample(
        await this.products.update(
          id,
          dto,
          await this.slicedFile(dto),
          await this.printFilesOf(dto),
        ),
      ),
      mayPrice,
    );
  }

  /** The product takes its sliced 3MF's own grams and time (purge, tower, supports in them). */
  private slicedFile(dto: {
    modelFileKey?: string | undefined;
    materialId: string;
    grams: string;
    printHours: string;
    printFiles?: { key: string }[];
    printFileKeys?: string[] | undefined;
  }): Promise<boolean> {
    return this.files.slicedNumbers(
      dto.modelFileKey,
      dto.materialId,
      dto.grams,
      dto.printHours,
      dto.printFiles?.map((f) => f.key) ?? dto.printFileKeys ?? [],
    );
  }

  /** The filaments a product's colours are printed from; refuses one that isn't on the shelf. */
  private async filamentPrices(
    colours: readonly { stockItemId?: string | undefined }[],
  ): Promise<Map<string, { pricePerGram: string }>> {
    const ids = [
      ...new Set(
        colours.flatMap((c) => (c.stockItemId ? [c.stockItemId] : [])),
      ),
    ];
    if (ids.length === 0) return new Map();
    const found = await this.products.filaments(ids);
    if (found.size !== ids.length)
      throw new BadRequestException(
        "Choose each colour's filament from the stock again",
      );
    return found;
  }

  /** The product's print files as they are kept: read from the files, never from the page. */
  private async printFilesOf(
    dto: SaveProductDto,
  ): Promise<ProductPrintFileView[]> {
    if (dto.printFiles.length === 0) return [];
    return (await this.files.printFiles(dto.printFiles, dto.materialId)).files;
  }

  /**
   * Every product a quotation line may be made from, hidden ones too: a piece made for one
   * client is priced and ordered like any other without being in the shop.
   */
  async quotable(): Promise<QuotableProduct[]> {
    const [all, calculator] = await Promise.all([
      this.products.all(),
      this.pricing.costCalculator(),
    ]);
    return all
      .filter((p) => p.textStyle === null && !p.studioOnly)
      .map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        price: this.configurator.unitPrice(
          calculator,
          p,
          this.configurator.starting(p),
        ),
        active: p.active,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** A product's real sizes with their prices, for a quotation line (hidden products too). */
  async quotableSizes(slug: string): Promise<QuotableSize[]> {
    const p = await this.products.findBySlug(slug);
    if (!p) throw new NotFoundException('Product not found');
    const calculator = await this.pricing.costCalculator();
    return p.sizes.map((size) => ({
      id: size.id,
      label: formatSizeCm({
        x: size.sizeXcm.toString(),
        y: size.sizeYcm.toString(),
        z: size.sizeZcm.toString(),
      }),
      x: size.sizeXcm.toString(),
      y: size.sizeYcm.toString(),
      z: size.sizeZcm.toString(),
      unitPrice: this.configurator.unitPrice(
        calculator,
        p,
        this.configurator.configure(p, [
          { groupId: PRODUCT_SIZE_GROUP_ID, valueId: size.id },
          // Its other required options at their starting choices.
          ...this.configurator
            .starting(p)
            .selections.filter((x) => x.groupId !== PRODUCT_SIZE_GROUP_ID),
        ]),
      ),
    }));
  }

  /** The sliced print files read and added up, for the product being edited. */
  printFilesInfo(dto: PrintFilesDto): Promise<PrintFilesTotal> {
    return this.files.printFiles(dto.files, dto.materialId);
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
    const wasteIncluded = await this.slicedFile(dto);
    // Colours printed from filaments on the shelf cost what those filaments cost.
    const filaments = await this.filamentPrices(dto.colours ?? []);
    const pricePerGram = averagePricePerGram(
      material.pricePerGram.toString(),
      (dto.colours ?? []).map((c) => ({
        grams: c.grams,
        pricePerGram: c.stockItemId
          ? (filaments.get(c.stockItemId)?.pricePerGram ?? null)
          : null,
      })),
    );
    let b;
    try {
      b = (await this.pricing.costCalculator()).price(
        {
          grams: dto.grams,
          printHours: dto.printHours,
          pricePerGram,
          wasteIncluded,
          extraCost: extraCostOf({ extraCosts: dto.extraCosts ?? [] }),
        },
        profit,
      );
    } catch (error) {
      if (error instanceof PricingError)
        throw new BadRequestException(error.message);
      throw error;
    }
    const printerParts = mayPrice
      ? await this.pricing.printerSplit(b.machineCost)
      : null;
    // The owner's own price: what it sells at with nothing chosen (the base itself).
    return {
      unitPrice: dto.priceOverride
        ? new Prisma.Decimal(dto.priceOverride).toFixed(2)
        : b.unitPrice,
      calculatedPrice: b.unitPrice,
      wasteIncluded,
      breakdown: mayPrice
        ? {
            material: b.materialCost,
            printer: b.machineCost,
            printerWear: printerParts?.wear ?? null,
            electricity: printerParts?.electricity ?? null,
            wasteAndFailures: new Prisma.Decimal(b.wasteCost)
              .plus(b.failureAllowance)
              .toFixed(2),
            labour: b.laborCost,
            packaging: b.packagingCost,
            extras: b.extraCost,
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

  /** The product's set-up checked; its text and logo slots as they will be saved. */
  private async checkSetup(dto: SaveProductDto): Promise<SaveProductDto> {
    if (dto.studioOnly && dto.active)
      throw new BadRequestException(
        'A studio-only product is never sold: untick "Visible in the shop"',
      );
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
          ].filter((id): id is string => typeof id === 'string'),
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
    const colours = dto.colours.map((c) => c.colour.toLowerCase());
    if (new Set(colours).size !== colours.length) {
      throw new BadRequestException('A colour is listed twice');
    }
    if (dto.colours.length > 0) {
      // They are the product's grams split by colour: they must add up (to a gram).
      const sum = dto.colours.reduce(
        (n, c) => n.plus(c.grams),
        new Prisma.Decimal(0),
      );
      if (sum.minus(dto.grams).abs().gt(1)) {
        throw new BadRequestException(
          `The colours add up to ${sum.toFixed(1)} g; the product takes ${dto.grams} g`,
        );
      }
    }
    await this.checkParts(dto);
    await this.filamentPrices(dto.colours);
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
    if (dto.text?.style === 'KEYCHAIN')
      await this.slots.checkLogos(dto.text.logoIds);
    const slots = await this.slots.check(dto.slots, [
      dto.partColourGroupId,
      dto.text?.colourGroupId,
    ]);
    return { ...dto, slots };
  }

  /**
   * Parts customers recolour: each named once (and not like another option), each a different
   * file colour, from a colour group the shop offers, starting in one of its colours.
   */
  private async checkParts(dto: SaveProductDto): Promise<void> {
    if (dto.colours.some((c) => c.part === ''))
      throw new BadRequestException(
        'Name each colour customers choose (e.g. Body)',
      );
    const parts = dto.colours.filter((c) => c.part);
    if (parts.length === 0) return;
    const names = parts.map((c) => c.part!.toLowerCase());
    if (new Set(names).size !== names.length)
      throw new BadRequestException('Two parts have the same name');
    if (new Set(parts.map((c) => c.hex.toLowerCase())).size !== parts.length)
      throw new BadRequestException(
        'Two parts customers recolour share a file colour',
      );
    if (!dto.partColourGroupId)
      throw new BadRequestException(
        'Choose the colours customers pick parts in',
      );
    const group = await this.products.partColours(dto.partColourGroupId);
    if (!group || group.values.length === 0)
      throw new BadRequestException(
        'Choose a colour group with colours switched on, each with a swatch',
      );
    const taken = new Set(
      [
        'size',
        ...(
          await this.products.optionGroups(dto.options.map((o) => o.groupId))
        ).map((g) => g.name),
      ].map((n) => n.toLowerCase()),
    );
    const clash = parts.find((c) => taken.has(c.part!.toLowerCase()));
    if (clash)
      throw new BadRequestException(
        `"${clash.part}" is already an option of this product: name the part differently`,
      );
    const offered = new Set(group.values.map((v) => v.label.toLowerCase()));
    // A part printed from a filament on the shelf goes by that filament's name: customers
    // then start at the first colour offered.
    const outside = parts.find(
      (c) => !c.stockItemId && !offered.has(c.colour.toLowerCase()),
    );
    if (outside)
      throw new BadRequestException(
        `${outside.part} starts in ${outside.colour}, which isn't one of the colours customers pick from`,
      );
  }

  private async toAdmin(
    p: ConfigurableProduct,
    mayPrice = true,
  ): Promise<AdminProduct> {
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
      studioOnly: p.studioOnly,
      modelFileKey: p.modelFileKey,
      imageKeys: p.imageKeys,
      text: this.studio.settingsView(p),
      // What the studio earns on it is for whoever manages pricing.
      profit: mayPrice ? profitOf(p) : null,
      priceOverride: mayPrice ? (p.priceOverride?.toFixed(2) ?? null) : null,
      extraCosts: mayPrice
        ? p.extraCosts.map((e) => ({
            label: e.label,
            amount: e.amount.toFixed(2),
          }))
        : [],
      colours: p.colours.map((c) => ({
        colour: c.colour,
        hex: c.hex,
        grams: c.grams.toString(),
        part: c.part,
        startsAs: c.startsAs,
        stockItemId: c.stockItemId,
      })),
      partColourGroupId: p.partColourGroupId,
      slicedFile: p.slicedFile,
      printFiles: p.printFiles.map(printFileView),
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
      slots: this.slots.of(p),
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

/** A kept print file as the dashboard shows it (its details are the API's own snapshot). */
function printFileView(f: {
  fileKey: string;
  name: string;
  grams: { toFixed(digits: number): string };
  printHours: { toFixed(digits: number): string };
  details: unknown;
}): ProductPrintFileView {
  const details = f.details as {
    colours: ProductPrintFileView['colours'];
    setup: PrintSetup;
  };
  return {
    fileKey: f.fileKey,
    name: f.name,
    grams: f.grams.toFixed(2),
    printHours: f.printHours.toFixed(2),
    colours: details.colours,
    setup: details.setup,
  };
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
    "Only someone who manages pricing can change a product's profit or price",
  );

/** The configuration with the grams and hours its text and logo slots add. */
function withSlots(
  configuration: Configuration,
  slots: { grams: string; printHours: string } | null,
): Configuration {
  return slots ? { ...configuration, extra: slots } : configuration;
}
