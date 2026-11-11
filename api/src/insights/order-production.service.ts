import { Injectable, NotFoundException } from '@nestjs/common';
import type { OrderProduction } from '@forgea/types';
import { splitTaxIncluded } from '../accounting/ledger-math.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { StockMovementKind } from '../generated/prisma/enums.js';
import { ProductionEstimator } from '../stock/production-estimator.js';
import { InsightsRepository } from './insights.repository.js';

const D = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v);

/**
 * What one order takes to make, for its page's summary: the filament each line needs by
 * colour and its print time (estimated from the products, their sliced files and the options
 * bought, as stock is), what stock really gave it, and what it costs and earns. Cost and
 * profit are estimates from today's pricing settings, shown only to those who see the books.
 */
@Injectable()
export class OrderProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estimator: ProductionEstimator,
    private readonly insights: InsightsRepository,
  ) {}

  async forOrder(
    orderId: string,
    withMoney: boolean,
  ): Promise<OrderProduction> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        items: {
          orderBy: { id: 'asc' },
          select: {
            id: true,
            name: true,
            quantity: true,
            lineTotal: true,
            productId: true,
            options: true,
            design: true,
            printFile: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    const [{ estimate }, taken, taxRate] = await Promise.all([
      this.estimator.for(order.items),
      this.prisma.stockMovement.findMany({
        where: {
          orderItem: { orderId },
          kind: { in: [StockMovementKind.ORDER, StockMovementKind.RETURNED] },
        },
        select: {
          grams: true,
          stockItem: {
            select: { colour: true, material: { select: { code: true } } },
          },
        },
      }),
      withMoney ? this.insights.salesTaxRate() : null,
    ]);

    let grams = D(0);
    let hours = D(0);
    let cost: Prisma.Decimal | null = D(0);
    let revenue = D(0);
    const lines = order.items.map((item) => {
      const e = estimate(item);
      const lineRevenue = splitTaxIncluded(item.lineTotal, taxRate).base;
      revenue = revenue.plus(lineRevenue);
      if (!e) {
        // A line that can't be estimated leaves the order's cost unknown, not understated.
        cost = null;
        return {
          itemId: item.id,
          name: item.name,
          quantity: item.quantity,
          grams: null,
          printHours: null,
          colours: [],
          cost: null,
        };
      }
      const lineGrams = D(e.gramsPerUnit).times(item.quantity);
      const lineHours = D(e.hoursPerUnit).times(item.quantity);
      const lineCost = D(e.unitCost).times(item.quantity);
      grams = grams.plus(lineGrams);
      hours = hours.plus(lineHours);
      cost = cost?.plus(lineCost) ?? null;
      return {
        itemId: item.id,
        name: item.name,
        quantity: item.quantity,
        grams: lineGrams.toFixed(1),
        printHours: lineHours.toFixed(2),
        colours: (
          e.colours ?? [{ colour: e.colour, gramsPerUnit: e.gramsPerUnit }]
        ).map((c) => ({
          colour: c.colour,
          grams: D(c.gramsPerUnit).times(item.quantity).toFixed(1),
        })),
        cost: withMoney ? lineCost.toFixed(2) : null,
      };
    });

    // What stock gave the order, per reel: taken when it went into production, less returns.
    const reels = new Map<
      string,
      { material: string; colour: string; grams: number }
    >();
    for (const m of taken) {
      const key = `${m.stockItem.material.code}\u0000${m.stockItem.colour}`;
      const reel = reels.get(key) ?? {
        material: m.stockItem.material.code,
        colour: m.stockItem.colour,
        grams: 0,
      };
      reel.grams -= m.grams;
      reels.set(key, reel);
    }

    const knownCost = cost as Prisma.Decimal | null;
    const profit = knownCost ? revenue.minus(knownCost) : null;
    return {
      lines,
      grams: grams.toFixed(1),
      printHours: hours.toFixed(2),
      taken: [...reels.values()].filter((r) => r.grams !== 0),
      money:
        withMoney && knownCost && profit
          ? {
              revenue: revenue.toFixed(2),
              cost: knownCost.toFixed(2),
              profit: profit.toFixed(2),
              marginPercent: revenue.gt(0)
                ? profit.times(100).div(revenue).toFixed(1)
                : null,
            }
          : null,
    };
  }
}
