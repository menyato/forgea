import { Injectable } from '@nestjs/common';
import type { ChosenOption } from '@forgea/types';
import { PrismaService } from '../database/prisma.service.js';
import { OptionKind } from '../generated/prisma/enums.js';
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
              category: { select: { name: true } },
            },
          })
        : [],
      groups.length
        ? this.prisma.optionValue.findMany({
            where: { group: { name: { in: groups }, kind: OptionKind.CHOICE } },
            include: { group: { select: { name: true } } },
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
        estimateItem(
          catalog,
          calculator,
          line.productId,
          chosenOptions(line.options),
        ),
    };
  }
}
