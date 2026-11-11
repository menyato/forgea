import { Injectable } from '@nestjs/common';
import type { ChosenOption, PrintFile } from '@forgea/types';
import { PrismaService } from '../database/prisma.service.js';
import { OptionKind } from '../generated/prisma/enums.js';
import type { UnitCostCalculator } from '@forgea/pricing';
import { PricingService } from '../pricing/pricing.service.js';
import {
  type Catalog,
  estimateItem,
  type ItemEstimate,
  sizeLabel,
  valueKey,
} from './production-estimate.js';

/** Order lines as the queries group them: one per product and set of options. */
export interface LineConfig {
  productId: string | null;
  options: unknown;
  /** A personalised piece: its design as ordered, with the grams and hours it takes. */
  design?: unknown;
  /** Made from a 3MF (a quotation line, a custom request): what one unit takes (PrintFile). */
  printFile?: unknown;
}

export type Estimate = (line: LineConfig) => ItemEstimate | null;

/** The options JSON of an order line, read defensively (it is a stored snapshot). */
function chosenOptions(json: unknown): ChosenOption[] {
  const list: unknown = typeof json === 'string' ? JSON.parse(json) : json;
  if (!Array.isArray(list)) return [];
  return list.flatMap((o: unknown) => {
    if (typeof o !== 'object' || o === null) return [];
    const { group, value } = o as Record<string, unknown>;
    return typeof group === 'string' && typeof value === 'string'
      ? [{ group, value }]
      : [];
  });
}

/**
 * Loads what estimating these lines needs in three queries (their products with sizes, the
 * option values they name, the materials' prices) and today's cost settings, then estimates
 * each line in memory — never one query per line.
 */
@Injectable()
export class ProductionEstimator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  async for(lines: readonly LineConfig[]): Promise<{
    estimate: Estimate;
    catalog: Catalog;
  }> {
    const productIds = [
      ...new Set(lines.flatMap((l) => (l.productId ? [l.productId] : []))),
    ];
    const groups = [
      ...new Set(
        lines.flatMap((l) => chosenOptions(l.options).map((o) => o.group)),
      ),
    ];
    const [products, values, materials, calculator] = await Promise.all([
      productIds.length
        ? this.prisma.product.findMany({
            where: { id: { in: productIds } },
            include: {
              sizes: { orderBy: { sortOrder: 'asc' } },
              colours: {
                orderBy: { sortOrder: 'asc' },
                include: {
                  stockItem: {
                    select: {
                      materialId: true,
                      colour: true,
                      pricePerGram: true,
                      material: { select: { pricePerGram: true } },
                    },
                  },
                },
              },
              category: { select: { name: true } },
              partColourGroup: { select: { name: true } },
            },
          })
        : [],
      groups.length
        ? this.prisma.optionValue.findMany({
            where: { group: { name: { in: groups }, kind: OptionKind.CHOICE } },
            include: {
              group: { select: { name: true } },
              stockItem: {
                select: {
                  materialId: true,
                  colour: true,
                  pricePerGram: true,
                  material: { select: { pricePerGram: true } },
                },
              },
            },
          })
        : [],
      this.prisma.material.findMany({
        select: { id: true, pricePerGram: true },
      }),
      this.pricing.costCalculator(),
    ]);
    const catalog: Catalog = {
      products: new Map(
        products.map((p) => [
          p.id,
          {
            id: p.id,
            name: p.name,
            category: p.category?.name ?? null,
            grams: p.grams.toString(),
            printHours: p.printHours.toString(),
            materialId: p.materialId,
            slicedFile: p.slicedFile,
            colours: p.colours.map((c) => ({
              colour: c.colour,
              grams: c.grams.toString(),
              part: c.part,
              filament: filamentOf(c.stockItem),
            })),
            partColourGroup: p.partColourGroup?.name ?? null,
            sizes: p.sizes.map((s) => ({
              label: sizeLabel(s),
              grams: s.grams.toString(),
              printHours: s.printHours.toString(),
              isDefault: s.isDefault,
            })),
          },
        ]),
      ),
      values: new Map(
        values.map((v) => [
          valueKey(v.group.name, v.label),
          {
            gramsMultiplier: v.gramsMultiplier.toString(),
            hoursMultiplier: v.hoursMultiplier.toString(),
            materialId: v.materialId,
            swatchHex: v.swatchHex,
            filament: filamentOf(v.stockItem),
          },
        ]),
      ),
      pricePerGram: new Map(
        materials.map((m) => [m.id, m.pricePerGram.toString()]),
      ),
    };
    return {
      catalog,
      estimate: (line) =>
        line.printFile
          ? printFileEstimate(catalog, calculator, line.printFile)
          : line.design
            ? designEstimate(catalog, calculator, line.productId, line.design)
            : estimateItem(
                catalog,
                calculator,
                line.productId,
                chosenOptions(line.options),
              ),
    };
  }
}

/** A filament on the shelf as estimates use it: what a gram costs is its own price, else its material's. */
function filamentOf(
  item: {
    materialId: string;
    colour: string;
    pricePerGram: { toString(): string } | null;
    material: { pricePerGram: { toString(): string } };
  } | null,
) {
  return item
    ? {
        materialId: item.materialId,
        colour: item.colour,
        pricePerGram: (
          item.pricePerGram ?? item.material.pricePerGram
        ).toString(),
      }
    : null;
}

/**
 * A personalised piece: its own grams and hours (made from the design at checkout), costed
 * with today's settings and its product's material, its grams split by colour.
 */
function designEstimate(
  catalog: Catalog,
  calculator: UnitCostCalculator,
  productId: string | null,
  design: unknown,
): ItemEstimate | null {
  const m = design as {
    grams?: string;
    printHours?: string;
    colours?: { label: string; grams: string }[];
  };
  const product = productId ? catalog.products.get(productId) : undefined;
  const pricePerGram = product
    ? catalog.pricePerGram.get(product.materialId)
    : undefined;
  if (!product || !pricePerGram || !m.grams || !m.printHours) return null;
  const colours = (m.colours ?? []).map((c) => ({
    colour: c.label,
    gramsPerUnit: c.grams,
  }));
  return {
    unitCost: calculator.price({
      grams: m.grams,
      printHours: m.printHours,
      pricePerGram,
    }).subtotal,
    gramsPerUnit: m.grams,
    hoursPerUnit: m.printHours,
    materialId: product.materialId,
    colour: colours[0]?.colour ?? '',
    colours,
  };
}

/**
 * A piece made from a 3MF: its own grams and hours (read from the file when it was quoted),
 * costed with today's settings and its material, its grams by colour.
 */
function printFileEstimate(
  catalog: Catalog,
  calculator: UnitCostCalculator,
  printFile: unknown,
): ItemEstimate | null {
  const p = printFile as Partial<PrintFile>;
  const pricePerGram = p.materialId
    ? catalog.pricePerGram.get(p.materialId)
    : undefined;
  if (!p.materialId || !pricePerGram || !p.grams || !p.printHours) return null;
  const colours = (p.colours ?? []).map((c) => ({
    colour: c.colour,
    gramsPerUnit: c.grams,
  }));
  return {
    unitCost: calculator.price({
      grams: p.grams,
      printHours: p.printHours,
      pricePerGram,
      wasteIncluded: p.sliced === true,
    }).subtotal,
    gramsPerUnit: p.grams,
    hoursPerUnit: p.printHours,
    materialId: p.materialId,
    colour: colours[0]?.colour ?? '',
    colours,
  };
}
