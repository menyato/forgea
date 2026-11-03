import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { StockMovementKind } from '../generated/prisma/enums.js';
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
}
