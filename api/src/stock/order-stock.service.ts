import { Injectable, Logger } from '@nestjs/common';
import type { PrintFile } from '@forgea/types';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  PrintJobStatus,
  ReadyPieceMovementKind,
  StockMovementKind,
} from '../generated/prisma/enums.js';
import {
  pieceDetails,
  ReadyPiecesRepository,
} from './ready-pieces.repository.js';
import { ProductionEstimator } from './production-estimator.js';
import { type ReelMovement, StockRepository } from './stock.repository.js';

/** What an order will take out of stock: one movement per line it can estimate. */
export interface OrderStockPlan {
  /**
   * From the stock lines on the shelf only: a 3MF line's colours from the reels the team
   * picked, a catalog line's from its material and colour's line.
   */
  onReels: ReelMovement[];
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
    private readonly pieces: ReadyPiecesRepository,
  ) {}

  /** Never throws: a line that can't be estimated is skipped (and logged), never blocking. */
  async plan(orderId: string, actorId: string): Promise<OrderStockPlan> {
    try {
      const order = await this.prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: {
          orderNumber: true,
          items: {
            // Catalog lines, and lines made from a 3MF (quotations, custom requests).
            where: {
              OR: [
                { productId: { not: null } },
                { printFile: { not: Prisma.DbNull } },
              ],
            },
            select: {
              id: true,
              productId: true,
              options: true,
              design: true,
              printFile: true,
              quantity: true,
              filaments: {
                select: {
                  colour: true,
                  stockItemId: true,
                  stockItem: {
                    select: {
                      pricePerGram: true,
                      material: { select: { pricePerGram: true } },
                    },
                  },
                },
              },
            },
          },
        },
      });
      const { estimate, catalog } = await this.estimator.for(order.items);
      const onReels: ReelMovement[] = [];
      for (const item of order.items) {
        // A 3MF line: each of its colours from the reel picked for it (the order can't go into
        // production without one per colour; OrderFilaments).
        const file = item.printFile as PrintFile | null;
        if (file && item.filaments.length > 0) {
          // One take per reel (two colours from one reel are one take).
          const byReel = new Map<string, ReelMovement>();
          for (const c of file.colours) {
            const picked = item.filaments.find((f) => f.colour === c.colour);
            const grams = new Prisma.Decimal(c.grams)
              .times(item.quantity)
              .ceil()
              .toNumber();
            if (!picked || grams <= 0) continue;
            const take = byReel.get(picked.stockItemId);
            if (take) take.grams -= grams;
            else
              byReel.set(picked.stockItemId, {
                stockItemId: picked.stockItemId,
                kind: StockMovementKind.ORDER,
                grams: -grams,
                orderItemId: item.id,
                costPerGram:
                  picked.stockItem.pricePerGram ??
                  picked.stockItem.material.pricePerGram,
                note: `Order ${order.orderNumber}`,
                createdById: actorId,
              });
          }
          onReels.push(...byReel.values());
          continue;
        }
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
          // A colour printed from a filament of another material (PETG supports) comes from
          // that material's shelf.
          const materialId =
            ('materialId' in part ? part.materialId : undefined) ??
            e.materialId;
          // Only a filament on the shelf: production never adds one by itself (a colour
          // with no stock line is left for the team, and noted).
          const reel = await this.stock.existingItem(
            this.prisma,
            materialId,
            part.colour,
          );
          if (!reel) {
            this.logger.warn(
              `Order ${order.orderNumber}: no stock line for ${part.colour} (line ${item.id}), nothing taken`,
            );
            continue;
          }
          onReels.push({
            stockItemId: reel,
            kind: StockMovementKind.ORDER,
            grams: -grams,
            orderItemId: item.id,
            // Its cost per gram today, so later price changes leave this cost as it was.
            costPerGram: catalog.pricePerGram.get(materialId) ?? null,
            note: `Order ${order.orderNumber}`,
            createdById: actorId,
          });
        }
      }
      return { onReels };
    } catch (error) {
      this.logger.warn(`Stock plan for order ${orderId}: ${String(error)}`);
      return { onReels: [] };
    }
  }

  async apply(
    tx: Prisma.TransactionClient,
    plan: OrderStockPlan,
  ): Promise<void> {
    await this.stock.recordOnReels(tx, plan.onReels);
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
    // Pieces already printed for it wait on the shelf, at what they cost.
    const printed = await tx.printJob.findMany({
      where: { orderId, status: PrintJobStatus.DONE },
      select: {
        id: true,
        quantity: true,
        goodPieces: true,
        sparePieces: true,
        materialCost: true,
        electricityCost: true,
        wearCost: true,
        orderItem: {
          select: { name: true, productId: true, options: true, design: true },
        },
      },
    });
    for (const job of printed) {
      const good = job.goodPieces ?? job.quantity;
      if (good <= 0) continue;
      const total = new Prisma.Decimal(job.materialCost ?? 0)
        .plus(job.electricityCost ?? 0)
        .plus(job.wearCost ?? 0);
      await this.pieces.add(tx, {
        productId: job.orderItem?.productId ?? null,
        name: job.orderItem?.name ?? `Print run for ${orderNumber}`,
        details: pieceDetails(job.orderItem?.options, job.orderItem?.design),
        kind: ReadyPieceMovementKind.LEFT_OVER,
        quantity: good,
        unitCost: total.div(good + job.sparePieces),
        printJobId: job.id,
        orderId,
        note: `Order ${orderNumber} was cancelled`,
        createdById: actorId,
      });
    }
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
      // What each reel gave the line, net: reels changed on the order (OrderFilaments) moved
      // what was taken with a return to one reel and a take from another.
      const byReel = new Map<
        string,
        {
          stockItemId: string;
          grams: number;
          costPerGram: Prisma.Decimal | null;
        }
      >();
      for (const m of item.stockMovements) {
        const reel = byReel.get(m.stockItemId);
        if (reel) {
          reel.grams += m.grams;
          if (m.grams < 0) reel.costPerGram = m.costPerGram;
        } else byReel.set(m.stockItemId, { ...m });
      }
      for (const m of byReel.values()) {
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
