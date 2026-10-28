import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CatalogAsset, CatalogFile } from '@forgea/types';
import { CategoriesService } from '../categories/categories.service.js';
import { MaterialsService } from '../materials/materials.service.js';
import { ProductOptionsService } from '../product-options/product-options.service.js';
import { ProductsRepository } from '../products/products.repository.js';
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
  ) {}

  async export(): Promise<CatalogFile> {
    const [materials, categories, groups, products] = await Promise.all([
      this.materials.list(),
      this.categories.list(false),
      this.options.list(),
      this.products.all(),
    ]);
    const materialCode = new Map(materials.map((m) => [m.id, m.code]));
    return {
      format: 'forgea-catalog',
      version: 1,
      exportedAt: new Date().toISOString(),
      materials: materials.map((m) => ({
        code: m.code,
        name: m.name,
        pricePerGram: m.pricePerGram,
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
          model: p.modelFileKey
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
