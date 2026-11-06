import { Injectable } from '@nestjs/common';
import type { PrintJobCounts } from '@forgea/types';
import type { PrintJobListQuery } from '@forgea/validation';
import { dateRange } from '../common/pagination/date-range.js';
import { keysetPage } from '../common/pagination/keyset.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  PrintJobStatus,
  StockMovementKind,
} from '../generated/prisma/enums.js';
import { StockRepository } from '../stock/stock.repository.js';

const withRefs = {
  order: { select: { orderNumber: true } },
  orderItem: { select: { id: true, name: true } },
  printer: {
    select: {
      id: true,
      name: true,
      watts: true,
      priceUsd: true,
      lifeHours: true,
    },
  },
  stockItem: {
    select: {
      id: true,
      colour: true,
      materialId: true,
      material: { select: { code: true, pricePerGram: true } },
    },
  },
} as const satisfies Prisma.PrintJobInclude;
export type PrintJobRow = Prisma.PrintJobGetPayload<{
  include: typeof withRefs;
}>;

export interface NewPrintJob {
  orderId: string;
  orderItemId: string | null;
  printerId: string | null;
  stockItemId: string | null;
  quantity: number;
  grams: string;
  hours: string;
  scheduledDate: Date | null;
  status: PrintJobStatus;
}

/** A job's plan or step; finishing it also writes what it took and cost. */
export interface PrintJobChange {
  status?: PrintJobStatus;
  scheduledDate?: Date | null;
  printerId?: string;
  stockItemId?: string;
  quantity?: number;
  grams?: string;
  hours?: string;
  actualGrams?: string;
  actualHours?: string;
  finishedAt?: Date;
  materialCost?: string;
  electricityKwh?: string;
  electricityCost?: string;
  wearCost?: string;
}

@Injectable()
export class PrintJobsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockRepository,
  ) {}

  list(query: PrintJobListQuery) {
    const scheduled = dateRange(query.scheduledFrom, query.scheduledTo);
    const where: Prisma.PrintJobWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.printer
        ? { printerId: query.printer === 'none' ? null : query.printer }
        : {}),
      ...(query.orderId ? { orderId: query.orderId } : {}),
      ...(scheduled ? { scheduledDate: scheduled } : {}),
      ...(query.q
        ? {
            OR: [
              {
                order: {
                  orderNumber: { contains: query.q, mode: 'insensitive' },
                },
              },
              {
                orderItem: { name: { contains: query.q, mode: 'insensitive' } },
              },
              { printer: { name: { contains: query.q, mode: 'insensitive' } } },
              {
                stockItem: {
                  colour: { contains: query.q, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
    return keysetPage<PrintJobRow>(
      {
        sortField: query.sort,
        kind: 'date',
        order: query.order,
        limit: query.limit,
        cursor: query.cursor,
        valueOf: (row) => row.createdAt,
      },
      ({ after, orderBy, take }) =>
        this.prisma.printJob.findMany({
          where: { AND: [where, after as Prisma.PrintJobWhereInput] },
          orderBy: orderBy as Prisma.PrintJobOrderByWithRelationInput[],
          take,
          include: withRefs,
        }),
    );
  }

  /** Jobs per status and per printer ("none": no printer chosen yet). */
  async counts(): Promise<PrintJobCounts> {
    const [byStatus, byPrinter] = await Promise.all([
      this.prisma.printJob.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.printJob.groupBy({
        by: ['printerId'],
        _count: { _all: true },
      }),
    ]);
    return {
      statuses: Object.fromEntries(
        byStatus.map((g) => [g.status, g._count._all]),
      ),
      printers: Object.fromEntries(
        byPrinter.map((g) => [g.printerId ?? 'none', g._count._all]),
      ),
    };
  }

  findById(id: string): Promise<PrintJobRow | null> {
    return this.prisma.printJob.findUnique({
      where: { id },
      include: withRefs,
    });
  }

  create(job: NewPrintJob): Promise<PrintJobRow> {
    return this.prisma.printJob.create({ data: job, include: withRefs });
  }

  /**
   * Applies a change if the job is still in `from` (two people moving the same card can't
   * both win), with its stock in the same transaction: a finished job takes what it used
   * beyond its order's estimate (or gives back what it didn't), a failed one takes the grams
   * it lost. Null when the job changed meanwhile.
   */
  update(
    id: string,
    from: PrintJobStatus,
    data: PrintJobChange,
    actorId: string,
  ): Promise<PrintJobRow | null> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.printJob.updateMany({
        where: { id, status: from },
        data,
      });
      if (count !== 1) return null;
      const job = await tx.printJob.findUniqueOrThrow({
        where: { id },
        include: withRefs,
      });
      const reel = job.stockItem;
      if (reel && data.status === PrintJobStatus.DONE && job.actualGrams) {
        // What the order took when it went into production, for this line (0 for a job that
        // isn't an order's line): only the difference moves now.
        const taken = job.orderItemId
          ? -(
              (
                await tx.stockMovement.aggregate({
                  where: {
                    orderItemId: job.orderItemId,
                    kind: StockMovementKind.ORDER,
                    stockItemId: reel.id,
                  },
                  _sum: { grams: true },
                })
              )._sum.grams ?? 0
            )
          : 0;
        const used = Math.ceil(Number(job.actualGrams));
        // Several jobs for one line share its estimate: each counts its own share.
        const share = job.orderItemId ? await this.shareOf(tx, job, taken) : 0;
        const difference = used - share;
        if (difference !== 0) {
          await this.stock.record(tx, [
            {
              materialId: reel.materialId,
              colour: reel.colour,
              kind: StockMovementKind.PRINTED,
              grams: -difference,
              printJobId: job.id,
              costPerGram: reel.material.pricePerGram,
              note: `Printed for order ${job.order.orderNumber}: ${used} g used${
                share ? `, ${share} g estimated` : ''
              }`,
              createdById: actorId,
            },
          ]);
        }
      }
      if (reel && data.status === PrintJobStatus.FAILED) {
        // Rounded up (a started gram is a used gram).
        await this.stock.record(tx, [
          {
            materialId: reel.materialId,
            colour: reel.colour,
            kind: StockMovementKind.FAILED_PRINT,
            grams: -Math.max(
              1,
              Math.ceil(Number(job.actualGrams ?? job.grams)),
            ),
            printJobId: job.id,
            costPerGram: reel.material.pricePerGram,
            note: `Failed print on ${job.printer?.name ?? 'a printer'} (order ${job.order.orderNumber})`,
            createdById: actorId,
          },
        ]);
      }
      return job;
    });
  }

  /**
   * The part of its line's estimate this job stands for: the line's grams taken at production
   * × its pieces over the line's pieces (whole grams).
   */
  private async shareOf(
    tx: Prisma.TransactionClient,
    job: PrintJobRow,
    taken: number,
  ): Promise<number> {
    const line = await tx.orderItem.findUnique({
      where: { id: job.orderItemId! },
      select: { quantity: true },
    });
    if (!line || line.quantity <= 0) return 0;
    return Math.round(
      (taken * Math.min(job.quantity, line.quantity)) / line.quantity,
    );
  }

  setCalendarEvent(id: string, calendarEventId: string | null) {
    return this.prisma.printJob.update({
      where: { id },
      data: { calendarEventId },
    });
  }

  orderExists(id: string): Promise<boolean> {
    return this.prisma.order.count({ where: { id } }).then((n) => n === 1);
  }

  itemOfOrder(orderId: string, itemId: string) {
    return this.prisma.orderItem.findFirst({ where: { id: itemId, orderId } });
  }

  activePrinter(id: string) {
    return this.prisma.printer.findFirst({ where: { id, active: true } });
  }

  activeReel(id: string) {
    return this.prisma.stockItem.findFirst({ where: { id, active: true } });
  }

  /** The electricity rate (USD per kWh), from the pricing settings; null when not set. */
  /** Totals over a product's finished print runs (see PrintJobsService.productCost). */
  async productTotals(productId: string) {
    const [row] = await this.prisma.$queryRaw<
      {
        done: number;
        failed: number;
        pieces: number;
        grams: Prisma.Decimal;
        hours: Prisma.Decimal;
        material: Prisma.Decimal;
        electricity: Prisma.Decimal;
        wear: Prisma.Decimal;
        sold: Prisma.Decimal;
      }[]
    >`
      SELECT
        COUNT(*) FILTER (WHERE j."status" = 'DONE')::int AS "done",
        COUNT(*) FILTER (WHERE j."status" = 'FAILED')::int AS "failed",
        COALESCE(SUM(j."quantity") FILTER (WHERE j."status" = 'DONE'), 0)::int AS "pieces",
        COALESCE(SUM(j."actualGrams"), 0) AS "grams",
        COALESCE(SUM(j."actualHours"), 0) AS "hours",
        COALESCE(SUM(j."materialCost"), 0) AS "material",
        COALESCE(SUM(j."electricityCost"), 0) AS "electricity",
        COALESCE(SUM(j."wearCost"), 0) AS "wear",
        COALESCE(SUM(i."unitPrice" * j."quantity") FILTER (WHERE j."status" = 'DONE'), 0) AS "sold"
      FROM "print_jobs" j
      JOIN "order_items" i ON i."id" = j."orderItemId"
      WHERE i."productId" = ${productId}::uuid
        AND j."status" IN ('DONE', 'FAILED')
        AND j."materialCost" IS NOT NULL`;
    return row!;
  }

  async electricityPerKwh(): Promise<Prisma.Decimal | null> {
    const s = await this.prisma.pricingSettings.findUnique({
      where: { id: 1 },
      select: { electricityPerKwh: true },
    });
    return s?.electricityPerKwh ?? null;
  }

  /** The items of an order that have no print job yet (each gets one when it goes into production). */
  itemsWithoutJobs(orderId: string) {
    return this.prisma.orderItem.findMany({
      where: { orderId, printJobs: { none: {} } },
      select: {
        id: true,
        productId: true,
        options: true,
        design: true,
        quantity: true,
      },
    });
  }

  /** The only printer in use, if there is exactly one (new jobs go to it). */
  async onlyPrinter(): Promise<string | null> {
    const printers = await this.prisma.printer.findMany({
      where: { active: true },
      select: { id: true },
      take: 2,
    });
    return printers.length === 1 ? printers[0]!.id : null;
  }

  reelFor(
    tx: Prisma.TransactionClient | PrismaService,
    materialId: string,
    colour: string,
  ) {
    return this.stock.itemFor(
      tx as Prisma.TransactionClient,
      materialId,
      colour,
    );
  }

  createMany(jobs: NewPrintJob[]) {
    return this.prisma.printJob.createMany({ data: jobs });
  }
}
