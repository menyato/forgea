import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  PrintJobStatus,
  StockMovementKind,
} from '../generated/prisma/enums.js';
import { ProductionEstimator } from './production-estimator.js';
import { type NewMovement, StockRepository } from './stock.repository.js';

/** What an order will take out of stock: one movement per line it can estimate. */
export interface OrderStockPlan {
  movements: NewMovement[];
}

/**
 * Takes an order's filament out of stock when it goes into production: by then printing
 * starts, and an order cancelled before it never touched the shelf. Each catalog line takes
 * its grams per unit (the chosen size and options, from today's catalog) × quantity, rounded
 * up to whole grams, from its material and colour. Custom work has no grams to take: the team
 * records it by hand.
 *
 * Planned before the status change (reads only) and applied inside its transaction, so the
 * status and the stock move together or not at all.
 */
@Injectable()
export class OrderStock {
  private readonly logger = new Logger(OrderStock.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly estimator: ProductionEstimator,
    private readonly stock: StockRepository,
  ) {}

  /** Never throws: a line that can't be estimated is skipped (and logged), never blocking. */
  async plan(orderId: string, actorId: string): Promise<OrderStockPlan> {
    try {
      const order = await this.prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: {
          orderNumber: true,
          items: {
            where: { productId: { not: null } },
            select: {
              id: true,
              productId: true,
              options: true,
              design: true,
              quantity: true,
            },
          },
        },
      });
      const { estimate, catalog } = await this.estimator.for(order.items);
      const movements: NewMovement[] = [];
      for (const item of order.items) {
        const e = estimate(item);
        if (!e) {
          this.logger.warn(
            `Order ${order.orderNumber}: no filament estimate for line ${item.id}`,
          );
          continue;
        }
        // A multi-colour piece takes from each colour's reel (one movement per reel).
        for (const part of e.colours ?? [
          { colour: e.colour, gramsPerUnit: e.gramsPerUnit },
        ]) {
          const grams = new Prisma.Decimal(part.gramsPerUnit)
            .times(item.quantity)
            .ceil()
            .toNumber();
          if (grams <= 0) continue;
          movements.push({
            materialId: e.materialId,
            colour: part.colour,
            kind: StockMovementKind.ORDER,
            grams: -grams,
            orderItemId: item.id,
            // Its cost per gram today, so later price changes leave this cost as it was.
            costPerGram: catalog.pricePerGram.get(e.materialId) ?? null,
            note: `Order ${order.orderNumber}`,
            createdById: actorId,
          });
        }
      }
      return { movements };
    } catch (error) {
      this.logger.warn(`Stock plan for order ${orderId}: ${String(error)}`);
      return { movements: [] };
    }
  }

  apply(tx: Prisma.TransactionClient, plan: OrderStockPlan): Promise<void> {
    return this.stock.record(tx, plan.movements);
  }

  /**
   * An order cancelled after it went into production, in the cancel's transaction: its print
   * runs not started are cancelled, and the filament it took for pieces nobody printed or is
   * printing comes back to the shelf (a line's grams × the share of its pieces not covered by
   * a done or running print). Runs already printing finish normally; their pieces then go to
   * the ready pieces.
   */
  async cancel(
    tx: Prisma.TransactionClient,
    orderId: string,
    orderNumber: string,
    actorId: string,
  ): Promise<void> {
    await tx.printJob.updateMany({
      where: {
        orderId,
        status: { in: [PrintJobStatus.QUEUED, PrintJobStatus.SCHEDULED] },
      },
      data: { status: PrintJobStatus.CANCELLED },
    });
    const items = await tx.orderItem.findMany({
      where: { orderId },
      select: {
        quantity: true,
        printJobs: {
          // A reprint stands in for pieces its original job already counts.
          where: {
            status: { in: [PrintJobStatus.DONE, PrintJobStatus.PRINTING] },
            replacesJobId: null,
          },
          select: { quantity: true },
        },
        stockMovements: {
          where: { kind: StockMovementKind.ORDER },
          select: { grams: true, stockItemId: true, costPerGram: true },
        },
      },
    });
    for (const item of items) {
      if (item.quantity <= 0) continue;
      const covered = Math.min(
        item.quantity,
        item.printJobs.reduce((n, j) => n + j.quantity, 0),
      );
      for (const m of item.stockMovements) {
        const back = Math.floor(
          (-m.grams * (item.quantity - covered)) / item.quantity,
        );
        if (back <= 0) continue;
        await tx.stockMovement.create({
          data: {
            stockItemId: m.stockItemId,
            kind: StockMovementKind.RETURNED,
            grams: back,
            costPerGram: m.costPerGram,
            note: `Order ${orderNumber} cancelled: not printed`,
            createdById: actorId,
          },
        });
      }
    }
  }
}
