import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { OrderRemovalPreview } from '@forgea/types';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

/**
 * Removes a test order entirely, admin only: the order, its print runs, the filament they took
 * (the shelf's totals follow), its pieces, and its invoices, credit notes and the payments
 * matched to them. Real orders are cancelled, never removed; this is for orders that never
 * happened. The database's guards allow these deletes only inside this one transaction.
 */
@Injectable()
export class OrderRemoval {
  constructor(private readonly prisma: PrismaService) {}

  /** What removing it takes away (and what stops it), shown before anything is removed. */
  async preview(orderId: string): Promise<OrderRemovalPreview> {
    return this.prisma.$transaction((tx) => this.plan(tx, orderId));
  }

  async remove(orderId: string, confirm: string): Promise<OrderRemovalPreview> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'order:' + orderId}))`;
      const plan = await this.plan(tx, orderId);
      if (confirm.trim() !== plan.orderNumber)
        throw new BadRequestException(
          `Type the order number (${plan.orderNumber}) to remove it`,
        );
      if (plan.blockedBy.length)
        throw new ConflictException(
          `It can't be removed: ${plan.blockedBy.join('; ')}`,
        );
      const ids = await this.ids(tx, orderId);
      // Only this transaction may delete what the guards protect.
      await tx.$executeRaw`SELECT set_config('forgea.removing', 'test-order', true)`;
      if (ids.reconciliations.length)
        await tx.reconciliation.deleteMany({
          where: { id: { in: ids.reconciliations } },
        });
      const entries = [...ids.entries, ...ids.payments];
      if (entries.length) {
        await tx.journalLine.deleteMany({
          where: { entryId: { in: entries } },
        });
        // Credit notes point at the invoice they credit: they go first.
        await tx.journalEntry.deleteMany({
          where: { id: { in: entries }, reversedEntryId: { not: null } },
        });
        await tx.journalEntry.deleteMany({ where: { id: { in: entries } } });
      }
      const materials = await tx.stockMovement.findMany({
        where: { id: { in: ids.movements } },
        select: { stockItem: { select: { materialId: true } } },
        distinct: ['stockItemId'],
      });
      await tx.stockMovement.deleteMany({
        where: { id: { in: ids.movements } },
      });
      // The materials' totals, counted again without them (the trigger counts on insert only).
      for (const id of new Set(materials.map((m) => m.stockItem.materialId)))
        await tx.$executeRaw`
          UPDATE "materials" SET "stockGrams" = GREATEST((
            SELECT coalesce(sum(m."grams"), 0) FROM "stock_movements" m
            JOIN "stock_items" i ON i."id" = m."stockItemId"
            WHERE i."materialId" = ${id}::uuid), 0)
          WHERE "id" = ${id}::uuid`;
      await tx.piece.deleteMany({ where: { orderItem: { orderId } } });
      await tx.printJob.updateMany({
        where: { orderId },
        data: { replacesJobId: null },
      });
      await tx.printJob.deleteMany({ where: { orderId } });
      await tx.order.delete({ where: { id: orderId } });
      return plan;
    });
  }

  private async plan(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<OrderRemovalPreview> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        orderNumber: true,
        _count: { select: { items: true, printJobs: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    const ids = await this.ids(tx, orderId);
    const [entries, quotation, request, readyPieces, pieces] =
      await Promise.all([
        tx.journalEntry.findMany({
          where: { id: { in: [...ids.entries, ...ids.payments] } },
          select: { number: true, type: true },
          orderBy: { createdAt: 'asc' },
        }),
        tx.quotation.findFirst({
          where: { orderId },
          select: { number: true },
        }),
        tx.customRequest.findFirst({
          where: { orderId },
          select: { id: true },
        }),
        tx.readyPieceMovement.count({
          where: { OR: [{ orderId }, { printJob: { orderId } }] },
        }),
        tx.piece.count({ where: { orderItem: { orderId } } }),
      ]);
    const blockedBy = [
      ...(quotation ? [`it was made from quotation ${quotation.number}`] : []),
      ...(request ? ['it was made from a custom request'] : []),
      ...(readyPieces
        ? ['pieces of it went to or came from the ready pieces']
        : []),
      ...(ids.sharedPayment
        ? ['a payment matched to it also pays something else']
        : []),
    ];
    return {
      orderNumber: order.orderNumber,
      lines: order._count.items,
      printRuns: order._count.printJobs,
      stockMovements: ids.movements.length,
      pieces,
      documents: entries.map(
        (e) => e.number ?? `draft ${e.type.toLowerCase()}`,
      ),
      blockedBy,
    };
  }

  /** Everything that goes with the order: its entries, the payments matched to them, stock. */
  private async ids(tx: Prisma.TransactionClient, orderId: string) {
    const own = await tx.journalEntry.findMany({
      where: {
        OR: [{ orderId }, { reversedEntry: { orderId } }],
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    const ownLines = own.flatMap((e) => e.lines.map((l) => l.id));
    const matched = await tx.reconciliation.findMany({
      where: {
        OR: [
          { debitLineId: { in: ownLines } },
          { creditLineId: { in: ownLines } },
        ],
      },
      select: {
        id: true,
        debitLine: { select: { entryId: true } },
        creditLine: { select: { entryId: true } },
      },
    });
    const ownIds = new Set(own.map((e) => e.id));
    const payments = [
      ...new Set(
        matched
          .flatMap((r) => [r.debitLine.entryId, r.creditLine.entryId])
          .filter((id) => !ownIds.has(id)),
      ),
    ];
    // A payment that also settles something else stays: it can't go with this order.
    const paymentLines = await tx.journalLine.findMany({
      where: { entryId: { in: payments } },
      select: { id: true },
    });
    const reconciliationsOfPayments = await tx.reconciliation.findMany({
      where: {
        OR: [
          { debitLineId: { in: paymentLines.map((l) => l.id) } },
          { creditLineId: { in: paymentLines.map((l) => l.id) } },
        ],
      },
      select: { id: true },
    });
    const matchedIds = new Set(matched.map((r) => r.id));
    const sharedPayment = reconciliationsOfPayments.some(
      (r) => !matchedIds.has(r.id),
    );
    const movements = await tx.stockMovement.findMany({
      where: {
        OR: [{ orderItem: { orderId } }, { printJob: { orderId } }],
      },
      select: { id: true },
    });
    return {
      entries: [...ownIds],
      payments,
      reconciliations: [...matchedIds],
      movements: movements.map((m) => m.id),
      sharedPayment,
    };
  }
}
