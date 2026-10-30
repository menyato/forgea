import { createHash } from 'node:crypto';
import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import type {
  CatalogAsset,
  CatalogFile,
  CatalogImportReport,
  OptionGroupView,
} from '@forgea/types';
import {
  SaveCategoryDto,
  SaveMaterialDto,
  SaveOptionGroupDto,
  SaveOptionValueDto,
  SaveProductDto,
} from '@forgea/validation';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CategoriesService } from '../categories/categories.service.js';
import { UploadPurpose, UploadStatus } from '../generated/prisma/enums.js';
import { MaterialsService } from '../materials/materials.service.js';
import { ProductOptionsService } from '../product-options/product-options.service.js';
import { ProductsService } from '../products/products.service.js';
import { UploadsService } from '../uploads/uploads.service.js';

/** "add": create what is missing, leave everything else. "update": also overwrite matches. */
export type ImportMode = 'add' | 'update';

const KINDS = [
  'materials',
  'categories',
  'optionGroups',
  'optionValues',
  'products',
] as const;
type Kind = (typeof KINDS)[number];

/**
 * Loads a catalog file (docs/CATALOG_IMPORT.md) through the very services the dashboard uses,
 * each entry checked with the dashboard's own DTO, so imported data meets every rule a
 * hand-made product does. Entries are matched by natural key, never by id; files go through
 * the upload quarantine and are stored once (matched by their SHA-256). Nothing is deleted.
 *
 * Entries are applied in order; the first invalid one stops the import with its position in
 * the file. What came before it stays — importing the corrected file again is safe.
 */
@Injectable()
export class CatalogImporter {
  constructor(
    private readonly materials: MaterialsService,
    private readonly categories: CategoriesService,
    private readonly options: ProductOptionsService,
    private readonly products: ProductsService,
    private readonly uploads: UploadsService,
  ) {}

  async import(
    input: unknown,
    mode: ImportMode,
    actorId: string | null,
  ): Promise<CatalogImportReport> {
    const catalog = parseCatalogFile(input);
    const report: CatalogImportReport = {
      created: zero(),
      updated: zero(),
      skipped: 0,
    };
    const count = (kind: Kind, existed: boolean) => {
      report[existed ? 'updated' : 'created'][kind]++;
    };

    // Materials: stock is this installation's own inventory, never taken from a file.
    const materials = new Map(
      (await this.materials.list()).map((m) => [m.code, m]),
    );
    for (const [i, m] of catalog.materials.entries()) {
      await at(`materials[${i}] "${m.code}"`, async () => {
        const found = materials.get(String(m.code).toUpperCase());
        if (found && mode === 'add') return void report.skipped++;
        const dto = await valid(SaveMaterialDto, {
          ...pick(m, [
            'code',
            'name',
            'pricePerGram',
            'densityGPerCm3',
            'gramsPerHour',
            'active',
          ]),
          stockGrams: found?.stockGrams ?? 0,
          lowStockThresholdGrams: found?.lowStockThresholdGrams ?? 1000,
        });
        const saved = found
          ? await this.materials.update(found.id, dto)
          : await this.materials.create(dto);
        materials.set(saved.code, saved);
        count('materials', !!found);
      });
    }
    const materialId = (code: string | null, path: string) => {
      if (code === null) return undefined;
      const m = materials.get(code.toUpperCase());
      if (!m)
        throw new BadRequestException(`${path}: unknown material "${code}"`);
      return m.id;
    };

    const categories = new Map(
      (await this.categories.list(false)).map((c) => [c.slug, c]),
    );
    for (const [i, c] of catalog.categories.entries()) {
      await at(`categories[${i}] "${c.slug}"`, async () => {
        const found = categories.get(c.slug);
        if (found && mode === 'add') return void report.skipped++;
        const dto = await valid(SaveCategoryDto, {
          ...pick(c, ['slug', 'name', 'sortOrder', 'active']),
          ...(c.description ? { description: c.description } : {}),
        });
        const saved = found
          ? await this.categories.update(found.id, dto)
          : await this.categories.create(dto);
        categories.set(saved.slug, saved);
        count('categories', !!found);
      });
    }

    const groups = new Map((await this.options.list()).map((g) => [g.name, g]));
    for (const [i, g] of catalog.optionGroups.entries()) {
      const path = `optionGroups[${i}] "${g.name}"`;
      await at(path, async () => {
        let group = groups.get(g.name);
        if (!group || mode === 'update') {
          const dto = await valid(SaveOptionGroupDto, {
            ...pick(g, [
              'name',
              'kind',
              'textExtraPrice',
              'sortOrder',
              'active',
            ]),
            ...(g.maxLength === null ? {} : { maxLength: g.maxLength }),
          });
          const existed = !!group;
          group = group
            ? await this.options.updateGroup(group.id, dto)
            : await this.options.createGroup(dto);
          count('optionGroups', existed);
        } else report.skipped++;
        for (const [j, v] of (g.values ?? []).entries()) {
          await at(`${path} values[${j}] "${v.label}"`, async () => {
            const found = group!.values.find((x) => x.label === v.label);
            if (found && mode === 'add') return void report.skipped++;
            const material = materialId(v.material, 'material');
            const dto = await valid(SaveOptionValueDto, {
              ...pick(v, [
                'label',
                'gramsMultiplier',
                'hoursMultiplier',
                'extraPrice',
                'sortOrder',
                'active',
              ]),
              ...(v.swatchHex ? { swatchHex: v.swatchHex } : {}),
              ...(material ? { materialId: material } : {}),
            });
            group = found
              ? await this.options.updateValue(group!.id, found.id, dto)
              : await this.options.addValue(group!.id, dto);
            count('optionValues', !!found);
          });
        }
        groups.set(group.name, group);
      });
    }

    for (const [i, p] of catalog.products.entries()) {
      await at(`products[${i}] "${p.slug}"`, async () => {
        const found = await this.products.manageBySlug(p.slug);
        if (found && mode === 'add') return void report.skipped++;
        const category =
          p.category === null ? undefined : categories.get(p.category);
        if (p.category !== null && !category) {
          throw new BadRequestException(`unknown category "${p.category}"`);
        }
        const model = p.model
          ? await this.asset(p.model, UploadPurpose.PRODUCT_MODEL, actorId)
          : undefined;
        const images = [];
        for (const image of p.images ?? []) {
          images.push(
            await this.asset(image, UploadPurpose.PRODUCT_IMAGE, actorId),
          );
        }
        const dto = await valid(SaveProductDto, {
          ...pick(p, [
            'slug',
            'name',
            'description',
            'grams',
            'printHours',
            'isCustom',
            'active',
          ]),
          ...(category ? { categoryId: category.id } : {}),
          materialId: materialId(p.material, 'material'),
          ...(p.designer ? { designer: p.designer } : {}),
          ...(model ? { modelFileKey: model } : {}),
          imageKeys: images,
          options: (p.options ?? []).map((o) => productOption(groups, o)),
          ...(p.size
            ? { sizeXcm: p.size.x, sizeYcm: p.size.y, sizeZcm: p.size.z }
            : {}),
          sizes: (p.sizes ?? []).map((s) => ({
            label: s.label,
            sizeXcm: s.size?.x,
            sizeYcm: s.size?.y,
            sizeZcm: s.size?.z,
            grams: s.grams,
            printHours: s.printHours,
            isDefault: s.default === true,
          })),
        });
        if (found) await this.products.update(found.id, dto);
        else await this.products.create(dto);
        count('products', !!found);
      });
    }
    return report;
  }

  /** Stores a file from the catalog through quarantine and inspection, once per content. */
  private async asset(
    a: CatalogAsset,
    purpose: UploadPurpose,
    actorId: string | null,
  ): Promise<string> {
    if (typeof a?.base64 !== 'string' || typeof a.name !== 'string') {
      throw new BadRequestException('a file needs "name" and "base64"');
    }
    const data = Buffer.from(a.base64, 'base64');
    const sha256 = createHash('sha256').update(data).digest('hex');
    const known = await this.uploads.findCleanBySha256(sha256, purpose);
    if (known) return known;
    const upload = await this.uploads.receive(
      { data, originalName: a.name },
      purpose,
      actorId,
    );
    if (upload.status !== UploadStatus.CLEAN) {
      throw new BadRequestException(
        `"${a.name}": ${upload.rejectionReason ?? 'file refused'}`,
      );
    }
    return upload.storageKey;
  }
}

/** The format and version, and that each list is a list; entries are checked one by one. */
function parseCatalogFile(input: unknown): CatalogFile {
  const file = input as Partial<CatalogFile> | null;
  if (
    typeof file !== 'object' ||
    file === null ||
    file.format !== 'forgea-catalog'
  ) {
    throw new BadRequestException('This is not a Forgea catalog file');
  }
  if (file.version !== 1) {
    throw new BadRequestException(
      `Catalog version ${String(file.version)} is not supported`,
    );
  }
  for (const list of [
    'materials',
    'categories',
    'optionGroups',
    'products',
  ] as const) {
    if (file[list] !== undefined && !Array.isArray(file[list])) {
      throw new BadRequestException(`"${list}" must be a list`);
    }
  }
  return {
    format: 'forgea-catalog',
    version: 1,
    materials: file.materials ?? [],
    categories: file.categories ?? [],
    optionGroups: file.optionGroups ?? [],
    products: file.products ?? [],
  };
}

function productOption(
  groups: ReadonlyMap<string, OptionGroupView>,
  o: CatalogFile['products'][number]['options'][number],
) {
  const group = groups.get(o.group);
  if (!group)
    throw new BadRequestException(`unknown option group "${o.group}"`);
  const valueId = (label: string) => {
    const v = group.values.find((x) => x.label === label);
    if (!v)
      throw new BadRequestException(`"${o.group}" has no value "${label}"`);
    return v.id;
  };
  return {
    groupId: group.id,
    required: o.required,
    valueIds: (o.values ?? []).map(valueId),
    ...(o.default ? { defaultValueId: valueId(o.default) } : {}),
  };
}

/** Checks a value with the dashboard's DTO; the first problem is the error. */
async function valid<T extends object>(
  dto: new () => T,
  value: object,
): Promise<T> {
  const instance = plainToInstance(dto, value);
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const first = firstMessage(errors);
  if (first) throw new BadRequestException(first);
  return instance;
}

function firstMessage(
  errors: {
    constraints?: Record<string, string>;
    children?: unknown[];
    property: string;
  }[],
): string | undefined {
  for (const e of errors) {
    const message = e.constraints && Object.values(e.constraints)[0];
    if (message) return `${e.property}: ${message}`;
    const nested = firstMessage((e.children ?? []) as typeof errors);
    if (nested) return nested;
  }
  return undefined;
}

/** Runs one entry; any refusal is reported with where it is in the file. */
async function at(path: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      const message =
        typeof response === 'object' &&
        response !== null &&
        'message' in response
          ? String((response as { message: unknown }).message)
          : error.message;
      throw new BadRequestException(
        message.startsWith(path) ? message : `${path}: ${message}`,
      );
    }
    throw error;
  }
}

const pick = <T extends object, K extends keyof T>(o: T, keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, o[k]])) as Pick<T, K>;

const zero = () =>
  Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>;
