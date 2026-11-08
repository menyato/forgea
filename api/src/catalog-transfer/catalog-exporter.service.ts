import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CatalogAsset, CatalogFile } from '@forgea/types';
import { CategoriesService } from '../categories/categories.service.js';
import { MaterialsService } from '../materials/materials.service.js';
import { ProductOptionsService } from '../product-options/product-options.service.js';
import { profitOf } from '../products/product-configurator.js';
import { ProductsRepository } from '../products/products.repository.js';
import { FontsService } from '../text-studio/fonts.service.js';
import { UploadsService } from '../uploads/uploads.service.js';

/**
 * The whole catalog as one file — materials, categories, options with their price rules,
 * products with their 3D models and photos — ready to import into another installation.
 * Stock levels, orders and customers are never included.
 */
@Injectable()
export class CatalogExporter {
  constructor(
    private readonly materials: MaterialsService,
    private readonly categories: CategoriesService,
    private readonly options: ProductOptionsService,
    private readonly products: ProductsRepository,
    private readonly uploads: UploadsService,
    private readonly fonts: FontsService,
  ) {}

  /**
   * The whole catalog, or (`textOnly`) just the personalised-text products and what they use:
   * their categories, option groups, materials and the fonts — to start a shop with them.
   */
  async export(textOnly = false): Promise<CatalogFile> {
    const [allMaterials, allCategories, allGroups, allProducts] =
      await Promise.all([
        this.materials.list(),
        this.categories.list(false),
        this.options.list(),
        this.products.all(),
      ]);
    const products = textOnly
      ? allProducts.filter((p) => p.textStyle && p.textColourGroup)
      : allProducts;
    const usedGroups = new Set(
      products.flatMap((p) => [
        ...p.optionGroups.map((g) => g.group.name),
        ...(p.textColourGroup ? [p.textColourGroup.name] : []),
      ]),
    );
    const groups = textOnly
      ? allGroups.filter((g) => usedGroups.has(g.name))
      : allGroups;
    const usedMaterials = new Set([
      ...products.map((p) => p.material.code),
      ...groups.flatMap((g) =>
        g.values.flatMap((v) => (v.materialId ? [v.materialId] : [])),
      ),
    ]);
    const materials = textOnly
      ? allMaterials.filter(
          (m) => usedMaterials.has(m.code) || usedMaterials.has(m.id),
        )
      : allMaterials;
    const usedCategories = new Set(
      products.flatMap((p) => (p.category ? [p.category.slug] : [])),
    );
    const categories = textOnly
      ? allCategories.filter((c) => usedCategories.has(c.slug))
      : allCategories;
    const materialCode = new Map(materials.map((m) => [m.id, m.code]));
    return {
      format: 'forgea-catalog',
      version: 1,
      exportedAt: new Date().toISOString(),
      materials: materials.map((m) => ({
        code: m.code,
        name: m.name,
        pricePerGram: m.pricePerGram,
        reel:
          m.reelPrice !== null && m.reelGrams !== null
            ? { price: m.reelPrice, grams: m.reelGrams }
            : null,
        densityGPerCm3: m.densityGPerCm3,
        gramsPerHour: m.gramsPerHour,
        active: m.active,
      })),
      categories: categories.map((c) => ({
        slug: c.slug,
        name: c.name,
        description: c.description,
        sortOrder: c.sortOrder,
        active: c.active,
      })),
      optionGroups: groups.map((g) => ({
        name: g.name,
        kind: g.kind,
        maxLength: g.maxLength,
        textExtraPrice: g.textExtraPrice,
        sortOrder: g.sortOrder,
        active: g.active,
        values: g.values.map((v) => ({
          label: v.label,
          swatchHex: v.swatchHex,
          gramsMultiplier: v.gramsMultiplier,
          hoursMultiplier: v.hoursMultiplier,
          extraPrice: v.extraPrice,
          material: v.materialId
            ? (materialCode.get(v.materialId) ?? null)
            : null,
          sortOrder: v.sortOrder,
          active: v.active,
        })),
      })),
      fonts: await Promise.all(
        (await this.fonts.list()).map(async (f) => ({
          name: f.name,
          active: f.active,
          sortOrder: f.sortOrder,
          file: await this.asset(f.fileKey, `font ${f.name}`),
        })),
      ),
      products: await Promise.all(
        products.map(async (p) => ({
          slug: p.slug,
          name: p.name,
          description: p.description,
          category: p.category?.slug ?? null,
          material: p.material.code,
          grams: p.grams.toString(),
          printHours: p.printHours.toString(),
          isCustom: p.isCustom,
          designer: p.designer,
          active: p.active,
          // A generated sample (personalised products) is made again where it is imported.
          model:
            p.modelFileKey &&
            !(await this.products.isSampleModel(p.modelFileKey))
              ? await this.asset(p.modelFileKey, p.slug)
              : null,
          images: await Promise.all(
            p.imageKeys.map((k) => this.asset(k, p.slug)),
          ),
          options: p.optionGroups.map((pg) => {
            const values = p.optionValues.filter(
              (v) => v.value.groupId === pg.groupId,
            );
            return {
              group: pg.group.name,
              required: pg.required,
              values: values.map((v) => v.value.label),
              default: values.find((v) => v.isDefault)?.value.label ?? null,
            };
          }),
          profit: profitOf(p),
          priceOverride: p.priceOverride?.toFixed(2) ?? null,
          colours: p.colours.map((c) => ({
            colour: c.colour,
            hex: c.hex,
            grams: c.grams.toString(),
          })),
          text:
            p.textStyle && p.textColourGroup
              ? {
                  style: p.textStyle,
                  maxChars: p.textMaxChars!,
                  letterHeightMm: p.textHeightMm!.toString(),
                  letterDepthMm: p.textDepthMm!.toString(),
                  baseDepthMm: p.textBaseMm!.toString(),
                  maxWidthMm: p.textMaxWidthMm!.toString(),
                  colourGroup: p.textColourGroup.name,
                  extraColourPrice: p.textExtraColourPrice.toFixed(2),
                  sizesMm: p.textSizesMm.map((d) => d.toString()),
                  defaultColour:
                    p.textColourGroup.values.find(
                      (v) => v.id === p.textDefaultColourId,
                    )?.label ?? null,
                  defaultBaseColour:
                    p.textColourGroup.values.find(
                      (v) => v.id === p.textDefaultBaseId,
                    )?.label ?? null,
                  defaultAccentColour:
                    p.textColourGroup.values.find(
                      (v) => v.id === p.textDefaultAccentId,
                    )?.label ?? null,
                  decor: p.textDecor,
                }
              : null,
          size:
            p.sizeXcm && p.sizeYcm && p.sizeZcm
              ? {
                  x: p.sizeXcm.toString(),
                  y: p.sizeYcm.toString(),
                  z: p.sizeZcm.toString(),
                }
              : null,
          sizes: p.sizes.map((s) => ({
            label: s.label,
            size: {
              x: s.sizeXcm.toString(),
              y: s.sizeYcm.toString(),
              z: s.sizeZcm.toString(),
            },
            grams: s.grams.toString(),
            printHours: s.printHours.toString(),
            default: s.isDefault,
          })),
        })),
      ),
    };
  }

  /** A missing file is an error naming the product: an export must never lose data quietly. */
  private async asset(key: string, slug: string): Promise<CatalogAsset> {
    try {
      return {
        name: key.slice(key.lastIndexOf('/') + 1),
        base64: Buffer.from(await this.uploads.read(key)).toString('base64'),
      };
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
      throw new ConflictException(
        `Product "${slug}" uses a file that is missing from storage (${key}); upload it again, then export`,
      );
    }
  }
}
