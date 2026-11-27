import { Injectable } from '@nestjs/common';
import type { PrintJobCounts } from '@forgea/types';
import type { PrintJobListQuery } from '@forgea/validation';
import { dateRange } from '../common/pagination/date-range.js';
import { keysetPage } from '../common/pagination/keyset.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  OrderStatus,
  PrintJobStatus,
  ReadyPieceMovementKind,
  StockMovementKind,
} from '../generated/prisma/enums.js';
import {
  pieceDetails,
  ReadyPiecesRepository,
} from '../stock/ready-pieces.repository.js';
import { StockRepository } from '../stock/stock.repository.js';
import { onceForKey } from '../common/request-key.js';

const withRefs = {
  order: { select: { orderNumber: true, status: true } },
  orderItem: {
    select: {
      id: true,
      name: true,
      productId: true,
      options: true,
      design: true,
    },
  },
  reprints: { select: { id: true } },
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
  /** A reprint of a failed job, or of a job's missing pieces. */
  replacesJobId?: string | null;
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
  goodPieces?: number;
  sparePieces?: number;
  note?: string;
}

@Injectable()
export class PrintJobsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockRepository,
    private readonly pieces: ReadyPiecesRepository,
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

  /** A run planned by hand; the same form sent twice plans it once. */
  async create(
    requestKey: string | undefined,
    job: NewPrintJob,
  ): Promise<PrintJobRow> {
    const id = await this.prisma.$transaction((tx) =>
      onceForKey(tx, requestKey, 'print-job', async () => {
        const made = await tx.printJob.create({
          data: job,
          select: { id: true },
        });
        return made.id;
      }),
    );
    return this.prisma.printJob.findUniqueOrThrow({
      where: { id },
      include: withRefs,
    });
  }

  /**
   * Applies a change if the job is still in `from` (two people moving the same card can't
   * both win), with everything that follows in the same transaction: a finished job takes
   * the filament it used beyond its order's estimate (or gives back what it didn't), a failed
   * one takes the grams it lost; pieces nobody ordered (a full plate's spares, a cancelled
   * order's) go to the ready pieces; missing pieces get a reprint (`reprint`). Null when the
   * job changed meanwhile.
   */
  update(
    id: string,
    from: PrintJobStatus,
    data: PrintJobChange,
    actorId: string,
    reprint = false,
  ): Promise<PrintJobRow | null> {
    return this.prisma.$transaction(async (tx) => {
      // Its order, locked against a change meanwhile: a cancel waits for this step (or this
      // step for the cancel), so its pieces and reprints follow the order as it really is.
      await tx.$queryRaw`
        SELECT o."id" FROM "orders" o
        JOIN "print_jobs" j ON j."orderId" = o."id"
        WHERE j."id" = ${id}::uuid
        FOR SHARE OF o`;
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
        // isn't an order's line): only the difference moves now. The line's only run printed
        // all its colours, so it is weighed against all the line took (from every reel); runs
        // split one per reel each against their own reel.
        const taken = job.orderItemId
          ? await this.takenFor(tx, job.orderItemId, job.id, reel.id)
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
      if (data.status === PrintJobStatus.DONE)
        await this.toShelf(tx, job, actorId);
      if (reprint) await this.reprintMissing(tx, job);
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
      // As it is now (with the reprint just planned).
      return tx.printJob.findUniqueOrThrow({
        where: { id },
        include: withRefs,
      });
    });
  }

  /**
   * A done job's pieces nobody ordered go to the ready pieces at what they cost: a full
   * plate's spares, and all its good pieces when its order was cancelled meanwhile.
   */
  private async toShelf(
    tx: Prisma.TransactionClient,
    job: PrintJobRow,
    actorId: string,
  ): Promise<void> {
    const good = job.goodPieces ?? job.quantity;
    const cancelled = job.order.status === OrderStatus.CANCELLED;
    const pieces = (cancelled ? good : 0) + job.sparePieces;
    if (pieces <= 0) return;
    const made = good + job.sparePieces;
    const total = [
      job.materialCost,
      job.electricityCost,
      job.wearCost,
    ].reduce<Prisma.Decimal>(
      (sum, c) => sum.plus(c ?? 0),
      new Prisma.Decimal(0),
    );
    await this.pieces.add(tx, {
      productId: job.orderItem?.productId ?? null,
      name: job.orderItem?.name ?? `Print run for ${job.order.orderNumber}`,
      details: pieceDetails(job.orderItem?.options, job.orderItem?.design),
      kind: cancelled
        ? ReadyPieceMovementKind.LEFT_OVER
        : ReadyPieceMovementKind.PRINTED,
      quantity: pieces,
      unitCost: made > 0 ? total.div(made) : '0',
      printJobId: job.id,
      orderId: job.orderId,
      note: cancelled
        ? `Order ${job.order.orderNumber} was cancelled`
        : `Spare pieces from order ${job.order.orderNumber}`,
      createdById: actorId,
    });
  }

  /** The pieces a failed or partly good job didn't make, planned again (order still on). */
  private async reprintMissing(
    tx: Prisma.TransactionClient,
    job: PrintJobRow,
  ): Promise<void> {
    if (job.order.status === OrderStatus.CANCELLED) return;
    const missing =
      job.status === PrintJobStatus.FAILED
        ? job.quantity
        : job.status === PrintJobStatus.DONE
          ? job.quantity - (job.goodPieces ?? job.quantity)
          : 0;
    if (missing <= 0) return;
    const share = (v: Prisma.Decimal) =>
      Prisma.Decimal.max(
        v.times(missing).div(job.quantity).toDecimalPlaces(2),
        new Prisma.Decimal('0.01'),
      ).toString();
    await tx.printJob.create({
      data: {
        orderId: job.orderId,
        orderItemId: job.orderItemId,
        printerId: job.printerId,
        stockItemId: job.stockItemId,
        quantity: missing,
        grams: share(job.grams),
        hours: share(job.hours),
        status: PrintJobStatus.QUEUED,
        replacesJobId: job.id,
      },
    });
  }

  /**
   * Grams an order line took from stock when it went into production, as a run of it sees
   * them: all of them for the line's only run (a multi-colour piece printed at once), else
   * those of the run's own reel.
   */
  private async takenFor(
    tx: Prisma.TransactionClient,
    orderItemId: string,
    jobId: string,
    reelId: string,
  ): Promise<number> {
    const others = await tx.printJob.count({
      where: {
        orderItemId,
        id: { not: jobId },
        // A cancelled run printed nothing, and a failed one counts its own loss apart.
        status: { notIn: [PrintJobStatus.CANCELLED, PrintJobStatus.FAILED] },
      },
    });
    const sum = await tx.stockMovement.aggregate({
      where: {
        orderItemId,
        kind: StockMovementKind.ORDER,
        ...(others === 0 ? {} : { stockItemId: reelId }),
      },
      _sum: { grams: true },
    });
    return -(sum._sum.grams ?? 0);
  }

  /**
   * The part of its line's estimate this job stands for: the line's grams taken at production
   * × its pieces over the line's pieces (whole grams). A reprint stands for its share only
   * when the job it reprints failed (a failure used none of it); a reprint of a job's missing
   * pieces uses filament beyond the estimate, which that job already counted.
   */
  private async shareOf(
    tx: Prisma.TransactionClient,
    job: PrintJobRow,
    taken: number,
  ): Promise<number> {
    if (job.replacesJobId) {
      const original = await tx.printJob.findUnique({
        where: { id: job.replacesJobId },
        select: { status: true },
      });
      if (original?.status !== PrintJobStatus.FAILED) return 0;
    }
    const line = await tx.orderItem.findUnique({
      where: { id: job.orderItemId! },
      select: { quantity: true },
    });
    if (!line || line.quantity <= 0) return 0;
    return Math.round(
      (taken * Math.min(job.quantity, line.quantity)) / line.quantity,
    );
  }

  cancelledOnCalendar(orderId: string): Promise<PrintJobRow[]> {
    return this.prisma.printJob.findMany({
      where: {
        orderId,
        status: PrintJobStatus.CANCELLED,
        calendarEventId: { not: null },
      },
      include: withRefs,
    });
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
  /**
   * What production made and lost between `start` and `end` (by when each run finished). A
   * done run's bad pieces are lost in proportion: of the pieces it printed (its pieces and its
   * spares), the ones that didn't come out right.
   */
  async results(start: Date, end: Date) {
    const lostShare = Prisma.sql`CASE WHEN j."status" = 'FAILED' THEN 1
      ELSE (j."quantity" - coalesce(j."goodPieces", j."quantity"))::numeric
           / nullif(j."quantity" + j."sparePieces", 0) END`;
    const cost = Prisma.sql`(coalesce(j."materialCost", 0) + coalesce(j."electricityCost", 0) + coalesce(j."wearCost", 0))`;
    const finished = Prisma.sql`j."status" IN ('DONE', 'FAILED')
      AND j."finishedAt" >= ${start} AND j."finishedAt" < ${end}`;
    const [[totals], printers, [cancelled], [studio], [shelf], [moved]] =
      await Promise.all([
        this.prisma.$queryRaw<
          {
            done: number;
            failed: number;
            good: number;
            spare: number;
            lostPieces: number;
            gramsUsed: Prisma.Decimal;
            gramsLost: Prisma.Decimal;
            hours: Prisma.Decimal;
            hoursLost: Prisma.Decimal;
            kwh: Prisma.Decimal;
            costGood: Prisma.Decimal;
            costLost: Prisma.Decimal;
          }[]
        >`
      SELECT
        count(*) FILTER (WHERE j."status" = 'DONE')::int AS "done",
        count(*) FILTER (WHERE j."status" = 'FAILED')::int AS "failed",
        coalesce(sum(coalesce(j."goodPieces", j."quantity")) FILTER (WHERE j."status" = 'DONE'), 0)::int AS "good",
        coalesce(sum(j."sparePieces"), 0)::int AS "spare",
        coalesce(sum(CASE WHEN j."status" = 'FAILED' THEN j."quantity"
                     ELSE j."quantity" - coalesce(j."goodPieces", j."quantity") END), 0)::int AS "lostPieces",
        coalesce(sum(j."actualGrams"), 0) AS "gramsUsed",
        coalesce(sum(coalesce(j."actualGrams", 0) * ${lostShare}), 0) AS "gramsLost",
        coalesce(sum(j."actualHours"), 0) AS "hours",
        coalesce(sum(coalesce(j."actualHours", 0) * ${lostShare}), 0) AS "hoursLost",
        coalesce(sum(j."electricityKwh"), 0) AS "kwh",
        coalesce(sum(${cost} * (1 - ${lostShare})), 0) AS "costGood",
        coalesce(sum(${cost} * ${lostShare}), 0) AS "costLost"
      FROM "print_jobs" j
      WHERE ${finished}`,
        this.prisma.$queryRaw<
          {
            id: string;
            name: string;
            runs: number;
            failed: number;
            hours: Prisma.Decimal;
            kwh: Prisma.Decimal;
            lostCost: Prisma.Decimal;
          }[]
        >`
      SELECT p."id", p."name",
        count(*)::int AS "runs",
        count(*) FILTER (WHERE j."status" = 'FAILED')::int AS "failed",
        coalesce(sum(j."actualHours"), 0) AS "hours",
        coalesce(sum(j."electricityKwh"), 0) AS "kwh",
        coalesce(sum(${cost} * ${lostShare}), 0) AS "lostCost"
      FROM "print_jobs" j
      JOIN "printers" p ON p."id" = j."printerId"
      WHERE ${finished}
      GROUP BY p."id", p."name"
      ORDER BY p."name"`,
        this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS "n" FROM "print_jobs"
      WHERE "status" = 'CANCELLED' AND "updatedAt" >= ${start} AND "updatedAt" < ${end}`,
        // Studio prints that failed, recorded from the stock page (no print job).
        this.prisma.$queryRaw<{ grams: number; cost: Prisma.Decimal }[]>`
      SELECT coalesce(-sum(s."grams"), 0)::int AS "grams",
             coalesce(sum(coalesce(s."cost", -s."grams" * s."costPerGram")), 0) AS "cost"
      FROM "stock_movements" s
      WHERE s."kind" = 'FAILED_PRINT' AND s."printJobId" IS NULL
        AND s."createdAt" >= ${start} AND s."createdAt" < ${end}`,
        this.prisma.$queryRaw<
          { pieces: number; value: Prisma.Decimal }[]
        >`SELECT coalesce(sum("onHand"), 0)::int AS "pieces",
             coalesce(sum("onHand" * "unitCost"), 0) AS "value"
      FROM "ready_pieces"`,
        this.prisma.$queryRaw<
          {
            added: number;
            sold: number;
            usedOrScrapped: number;
            scrappedCost: Prisma.Decimal;
          }[]
        >`
      SELECT
        coalesce(sum("quantity") FILTER (WHERE "kind" IN ('PRINTED', 'LEFT_OVER', 'ADDED')), 0)::int AS "added",
        coalesce(-sum("quantity") FILTER (WHERE "kind" = 'SOLD'), 0)::int AS "sold",
        coalesce(-sum("quantity") FILTER (WHERE "kind" IN ('USED', 'SCRAPPED')), 0)::int AS "usedOrScrapped",
        coalesce(sum(-"quantity" * "unitCost") FILTER (WHERE "kind" = 'SCRAPPED'), 0) AS "scrappedCost"
      FROM "ready_piece_movements"
      WHERE "createdAt" >= ${start} AND "createdAt" < ${end}`,
      ]);
    return {
      totals: totals!,
      printers,
      cancelled: cancelled!.n,
      studio: studio!,
      shelf: shelf!,
      moved: moved!,
    };
  }

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
        COALESCE(SUM(i."lineTotal" * j."quantity" / i."quantity") FILTER (WHERE j."status" = 'DONE'), 0) AS "sold"
      FROM "print_jobs" j
      JOIN "order_items" i ON i."id" = j."orderItemId"
      WHERE i."productId" = ${productId}::uuid
        AND j."status" IN ('DONE', 'FAILED')`;
    return row!;
  }

  /** The shop's sales tax rate (percent), or null when prices carry none. */
  async salesTaxRate(): Promise<Prisma.Decimal | null> {
    const s = await this.prisma.accountingSettings.findUnique({
      where: { id: 1 },
      select: { salesTax: { select: { ratePercent: true } } },
    });
    return s?.salesTax?.ratePercent ?? null;
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
        // A 3MF line's estimate comes from its file; its reels from the team's picks.
        printFile: true,
        quantity: true,
        filaments: { select: { colour: true, stockItemId: true } },
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

  /** The shelf's stock line of this material and colour, or null (a run never adds one). */
  reelFor(
    db: Prisma.TransactionClient | PrismaService,
    materialId: string,
    colour: string,
  ) {
    return this.stock.existingItem(db, materialId, colour);
  }

  /**
   * The runs an order going into production makes by itself, only if it still is (a cancel
   * a moment later would otherwise leave runs on a cancelled order) and still has none.
   */
  createForOrder(orderId: string, jobs: NewPrintJob[]) {
    return this.prisma.$transaction(async (tx) => {
      const [order] = await tx.$queryRaw<{ status: string }[]>`
        SELECT "status" FROM "orders" WHERE "id" = ${orderId}::uuid FOR SHARE`;
      if (order?.status !== OrderStatus.IN_PRODUCTION) return;
      const taken = await tx.printJob.findMany({
        where: { orderId, orderItemId: { not: null } },
        select: { orderItemId: true },
      });
      const has = new Set(taken.map((j) => j.orderItemId));
      await tx.printJob.createMany({
        data: jobs.filter((j) => !j.orderItemId || !has.has(j.orderItemId)),
      });
    });
  }
}
