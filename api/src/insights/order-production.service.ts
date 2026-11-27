import { Injectable, NotFoundException } from '@nestjs/common';
import type { OrderProduction, PrintFile } from '@forgea/types';
import { splitTaxIncluded } from '../accounting/ledger-math.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  PrintJobStatus,
  StockMovementKind,
} from '../generated/prisma/enums.js';
import { ProductionEstimator } from '../stock/production-estimator.js';
import { InsightsRepository } from './insights.repository.js';
import { overPicks } from '../orders/order-filaments.service.js';

const D = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v);

/** What stock gave an order: its lines going into production and its print runs. */
const TAKEN_KINDS = [
  StockMovementKind.ORDER,
  StockMovementKind.RETURNED,
  StockMovementKind.PRINTED,
  StockMovementKind.FAILED_PRINT,
];

/**
 * What one order takes to make, for its page's summary: the filament each line needs by
 * colour and its print time, what stock really gave it, and what it costs and earns. A line
 * from a product is estimated from it (its sliced files and the options bought), as stock is;
 * a line without one (free text, an in-house piece) is measured by its finished print runs:
 * the grams and hours they really took and their recorded cost. Cost and profit only for those
 * who see the books; unknown when a line has neither.
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
            filaments: {
              select: {
                colour: true,
                stockItem: { select: { id: true, colour: true } },
              },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    const [{ estimate }, taken, runs, taxRate] = await Promise.all([
      this.estimator.for(order.items),
      this.prisma.stockMovement.findMany({
        where: {
          kind: { in: TAKEN_KINDS },
          OR: [{ orderItem: { orderId } }, { printJob: { orderId } }],
        },
        select: {
          grams: true,
          stockItem: {
            select: { colour: true, material: { select: { code: true } } },
          },
        },
      }),
      // Finished runs measure a line no product estimates.
      this.prisma.printJob.findMany({
        where: {
          orderId,
          orderItemId: { not: null },
          status: { in: [PrintJobStatus.DONE, PrintJobStatus.FAILED] },
        },
        select: {
          orderItemId: true,
          actualGrams: true,
          actualHours: true,
          materialCost: true,
          electricityCost: true,
          wearCost: true,
          stockItem: { select: { colour: true } },
        },
      }),
      withMoney ? this.insights.salesTaxRate() : null,
    ]);

    let grams = D(0);
    let hours = D(0);
    let cost: Prisma.Decimal | null = D(0);
    let revenue = D(0);
    // What its products need, per filament (material and colour).
    const needs = new Map<
      string,
      { materialId: string; colour: string; grams: Prisma.Decimal }
    >();
    const lines = order.items.map((item) => {
      const lineRevenue = splitTaxIncluded(item.lineTotal, taxRate).base;
      revenue = revenue.plus(lineRevenue);
      const e = estimate(item);
      if (e) {
        const lineGrams = D(e.gramsPerUnit).times(item.quantity);
        const lineHours = D(e.hoursPerUnit).times(item.quantity);
        const lineCost = D(e.unitCost).times(item.quantity);
        grams = grams.plus(lineGrams);
        hours = hours.plus(lineHours);
        cost = cost?.plus(lineCost) ?? null;
        for (const c of e.colours ?? [
          { colour: e.colour, gramsPerUnit: e.gramsPerUnit },
        ]) {
          const materialId =
            ('materialId' in c ? c.materialId : undefined) ?? e.materialId;
          const key = `${materialId}\u0000${c.colour}`;
          const need = needs.get(key) ?? {
            materialId,
            colour: c.colour,
            grams: D(0),
          };
          need.grams = need.grams.plus(D(c.gramsPerUnit).times(item.quantity));
          needs.set(key, need);
        }
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
          measured: false,
        };
      }
      const done = runs.filter(
        (r) => r.orderItemId === item.id && r.actualGrams !== null,
      );
      if (done.length === 0) {
        // Neither estimated nor printed yet: the order's cost is unknown, not understated.
        cost = null;
        return {
          itemId: item.id,
          name: item.name,
          quantity: item.quantity,
          grams: null,
          printHours: null,
          colours: [],
          cost: null,
          measured: false,
        };
      }
      const byReel = new Map<string, Prisma.Decimal>();
      let lineGrams = D(0);
      let lineHours = D(0);
      let lineCost = D(0);
      for (const r of done) {
        const g = D(r.actualGrams!);
        lineGrams = lineGrams.plus(g);
        lineHours = lineHours.plus(r.actualHours ?? 0);
        lineCost = lineCost
          .plus(r.materialCost ?? 0)
          .plus(r.electricityCost ?? 0)
          .plus(r.wearCost ?? 0);
        const reel = r.stockItem?.colour ?? '';
        byReel.set(reel, (byReel.get(reel) ?? D(0)).plus(g));
      }
      grams = grams.plus(lineGrams);
      hours = hours.plus(lineHours);
      cost = cost?.plus(lineCost) ?? null;
      // A 3MF line printed from reels picked per colour: its grams by those reels, as the
      // file shares them (in tenths of a gram), not all under the run's one reel.
      const tenths = overPicks(
        item.printFile as PrintFile | null,
        item.filaments.map((f) => ({
          colour: f.colour,
          id: f.stockItem.id,
          reel: f.stockItem.colour,
        })),
        lineGrams.times(10).round().toNumber(),
      );
      return {
        itemId: item.id,
        name: item.name,
        quantity: item.quantity,
        grams: lineGrams.toFixed(1),
        printHours: lineHours.toFixed(2),
        colours:
          tenths.length > 0
            ? tenths.map((t) => ({
                colour: t.reel,
                grams: D(t.grams).div(10).toFixed(1),
              }))
            : [...byReel].map(([colour, g]) => ({
                colour,
                grams: g.toFixed(1),
              })),
        cost: withMoney ? lineCost.toFixed(2) : null,
        measured: true,
      };
    });

    // What stock gave the order, per reel (less what was returned).
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

    const shelf = await this.shelfFor([...needs.values()]);

    const knownCost = cost as Prisma.Decimal | null;
    const profit = knownCost ? revenue.minus(knownCost) : null;
    return {
      lines,
      grams: grams.toFixed(1),
      printHours: hours.toFixed(2),
      taken: [...reels.values()].filter((r) => r.grams !== 0),
      shelf,
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

  /** Each filament needed against what its reel holds now (none: no such reel on the shelf). */
  private async shelfFor(
    needs: { materialId: string; colour: string; grams: Prisma.Decimal }[],
  ): Promise<OrderProduction['shelf']> {
    if (needs.length === 0) return [];
    const [materials, items] = await Promise.all([
      this.prisma.material.findMany({
        where: { id: { in: [...new Set(needs.map((n) => n.materialId))] } },
        select: { id: true, code: true },
      }),
      this.prisma.stockItem.findMany({
        where: {
          active: true,
          OR: needs.map((n) => ({
            materialId: n.materialId,
            colour: n.colour,
          })),
        },
        select: { id: true, materialId: true, colour: true },
      }),
    ]);
    const held = await this.prisma.stockMovement.groupBy({
      by: ['stockItemId'],
      where: { stockItemId: { in: items.map((i) => i.id) } },
      _sum: { grams: true },
    });
    const gramsOf = new Map(
      held.map((h) => [h.stockItemId, h._sum.grams ?? 0]),
    );
    return needs
      .filter((n) => n.colour !== '')
      .map((n) => {
        const item = items.find(
          (i) => i.materialId === n.materialId && i.colour === n.colour,
        );
        const onShelf = item ? Math.max(0, gramsOf.get(item.id) ?? 0) : null;
        const needed = Math.ceil(n.grams.toNumber());
        return {
          material: materials.find((m) => m.id === n.materialId)?.code ?? '',
          colour: n.colour,
          needed,
          onShelf,
          short: onShelf === null || onShelf < needed,
        };
      });
  }
}
