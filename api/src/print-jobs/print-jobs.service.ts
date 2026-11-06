import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  type Page,
  PRINT_JOB_FLOW,
  type PrintJobCounts,
  type PrintJobListItem,
  type ProductRealCost,
} from '@forgea/types';
import type {
  CreatePrintJobDto,
  PrintJobListQuery,
  UpdatePrintJobDto,
} from '@forgea/validation';
import { toPage } from '../common/pagination/keyset.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrintJobStatus } from '../generated/prisma/enums.js';
import { GoogleCalendar } from '../google/google-calendar.js';
import { ProductionEstimator } from '../stock/production-estimator.js';
import {
  type NewPrintJob,
  type PrintJobChange,
  PrintJobsRepository,
  type PrintJobRow,
} from './print-jobs.repository.js';

const HOUR_MS = 3_600_000;
/** Steps that put a job on a printer: it needs a printer and a reel first. */
const ON_A_PRINTER: readonly PrintJobStatus[] = [
  PrintJobStatus.SCHEDULED,
  PrintJobStatus.PRINTING,
  PrintJobStatus.DONE,
];

/**
 * The production planner: one job per order line, made by itself when the order goes into
 * production, each on a chosen printer from a chosen reel. Finishing a job records what it
 * really took (grams, hours) and what that cost (filament, electricity, printer wear), and
 * moves the stock by the difference from the estimate. Scheduled jobs are mirrored on the
 * studio's Google Calendar; a calendar failure is logged and never undoes the change.
 */
@Injectable()
export class PrintJobsService {
  private readonly logger = new Logger(PrintJobsService.name);

  constructor(
    private readonly jobs: PrintJobsRepository,
    private readonly calendar: GoogleCalendar,
    private readonly estimator: ProductionEstimator,
    private readonly prisma: PrismaService,
  ) {}

  async list(query: PrintJobListQuery): Promise<Page<PrintJobListItem>> {
    return toPage(await this.jobs.list(query), toItem);
  }

  async one(id: string): Promise<PrintJobListItem> {
    const job = await this.jobs.findById(id);
    if (!job) throw new NotFoundException('Print job not found');
    return toItem(job);
  }

  counts(): Promise<PrintJobCounts> {
    return this.jobs.counts();
  }

  async create(dto: CreatePrintJobDto): Promise<PrintJobListItem> {
    if (!(await this.jobs.orderExists(dto.orderId)))
      throw new NotFoundException('Order not found');
    if (
      dto.orderItemId &&
      !(await this.jobs.itemOfOrder(dto.orderId, dto.orderItemId))
    )
      throw new BadRequestException('That line is not in this order');
    // Only prints planned by themselves may start without an estimate.
    if (Number(dto.grams) <= 0)
      throw new BadRequestException('Grams it should take, more than 0');
    await this.checkChoices(dto.printerId, dto.stockItemId);
    const scheduled = dto.scheduledDate ? new Date(dto.scheduledDate) : null;
    if (scheduled && (!dto.printerId || !dto.stockItemId))
      throw new BadRequestException(
        'Choose the printer and the reel before scheduling it',
      );
    const job = await this.jobs.create({
      orderId: dto.orderId,
      orderItemId: dto.orderItemId ?? null,
      printerId: dto.printerId ?? null,
      stockItemId: dto.stockItemId ?? null,
      quantity: dto.quantity,
      grams: dto.grams,
      hours: dto.hours,
      scheduledDate: scheduled,
      status: scheduled ? PrintJobStatus.SCHEDULED : PrintJobStatus.QUEUED,
    });
    return toItem(await this.syncCalendar(job));
  }

  async update(
    id: string,
    dto: UpdatePrintJobDto,
    actorId: string,
  ): Promise<PrintJobListItem> {
    const job = await this.jobs.findById(id);
    if (!job) throw new NotFoundException('Print job not found');
    const finished =
      job.status === PrintJobStatus.DONE ||
      job.status === PrintJobStatus.FAILED ||
      job.status === PrintJobStatus.CANCELLED;
    const planning =
      dto.printerId !== undefined ||
      dto.stockItemId !== undefined ||
      dto.quantity !== undefined ||
      dto.grams !== undefined ||
      dto.hours !== undefined;
    const actuals =
      dto.actualGrams !== undefined || dto.actualHours !== undefined;
    if (finished && (planning || actuals || dto.scheduledDate !== undefined))
      throw new ConflictException('A finished job can no longer change');
    await this.checkChoices(dto.printerId, dto.stockItemId);

    const data: PrintJobChange = {};
    if (dto.printerId !== undefined) data.printerId = dto.printerId;
    if (dto.stockItemId !== undefined) data.stockItemId = dto.stockItemId;
    if (dto.quantity !== undefined) data.quantity = dto.quantity;
    if (dto.grams !== undefined) data.grams = dto.grams;
    if (dto.hours !== undefined) data.hours = dto.hours;
    if (dto.scheduledDate !== undefined) {
      data.scheduledDate =
        dto.scheduledDate === null ? null : new Date(dto.scheduledDate);
      // Putting a waiting job on the calendar schedules it; taking it off puts it back.
      if (job.status === PrintJobStatus.QUEUED && data.scheduledDate)
        data.status = PrintJobStatus.SCHEDULED;
      else if (
        job.status === PrintJobStatus.SCHEDULED &&
        data.scheduledDate === null
      )
        data.status = PrintJobStatus.QUEUED;
    }
    if (dto.status !== undefined && dto.status !== job.status) {
      if (!PRINT_JOB_FLOW[job.status].includes(dto.status))
        throw new BadRequestException(
          `A job that is ${job.status.toLowerCase()} can't become ${dto.status.toLowerCase()}`,
        );
      data.status = dto.status;
    }
    if (data.status && ON_A_PRINTER.includes(data.status)) {
      const printer = data.printerId ?? job.printerId;
      const reel = data.stockItemId ?? job.stockItemId;
      if (!printer || !reel)
        throw new BadRequestException('Choose the printer and the reel first');
    }
    if (
      actuals &&
      data.status !== PrintJobStatus.DONE &&
      data.status !== PrintJobStatus.FAILED
    )
      throw new BadRequestException(
        'What it really took is entered when it finishes or fails',
      );
    if (data.status === PrintJobStatus.DONE) {
      if (dto.actualGrams === undefined || dto.actualHours === undefined)
        throw new BadRequestException(
          'Enter the grams and hours it really took to finish it',
        );
      Object.assign(
        data,
        await this.costs(job, data, dto.actualGrams, dto.actualHours),
      );
    }
    if (
      data.status === PrintJobStatus.FAILED &&
      dto.actualGrams !== undefined
    ) {
      // What it used before failing is a real cost too (the product's real cost counts it).
      Object.assign(
        data,
        await this.costs(job, data, dto.actualGrams, dto.actualHours ?? '0'),
      );
      if (dto.actualHours === undefined) delete data.actualHours;
    }
    const updated = await this.jobs.update(id, job.status, data, actorId);
    if (!updated)
      throw new ConflictException(
        'Someone else just changed this job. Reload and try again.',
      );
    return toItem(await this.syncCalendar(updated));
  }

  /**
   * An order went into production: a job for each of its lines that has none, with the grams
   * and hours its product takes × its pieces, from the reel of its material and colour, on the
   * studio's printer when it has only one. Lines without a product (custom work) get a job
   * too, waiting for its reel and estimate. Never throws: a line that can't be planned is
   * logged and left for the team to add by hand.
   */
  async createForOrder(orderId: string): Promise<void> {
    try {
      const items = await this.jobs.itemsWithoutJobs(orderId);
      if (items.length === 0) return;
      const { estimate } = await this.estimator.for(items);
      const printerId = await this.jobs.onlyPrinter();
      const jobs: NewPrintJob[] = [];
      for (const item of items) {
        const e = estimate(item);
        const reel = e
          ? await this.jobs.reelFor(
              this.prisma,
              e.materialId,
              (e.colours?.[0]?.colour ?? e.colour).trim(),
            )
          : null;
        jobs.push({
          orderId,
          orderItemId: item.id,
          printerId,
          stockItemId: reel,
          quantity: item.quantity,
          grams: e
            ? new Prisma.Decimal(e.gramsPerUnit).times(item.quantity).toFixed(2)
            : '0',
          hours: e
            ? new Prisma.Decimal(e.hoursPerUnit).times(item.quantity).toFixed(2)
            : '0',
          scheduledDate: null,
          status: PrintJobStatus.QUEUED,
        });
      }
      await this.jobs.createMany(jobs);
    } catch (error) {
      this.logger.warn(`Print jobs for order ${orderId}: ${String(error)}`);
    }
  }

  /** The printer and reel chosen must exist and be in use. */
  private async checkChoices(
    printerId?: string,
    stockItemId?: string,
  ): Promise<void> {
    if (printerId && !(await this.jobs.activePrinter(printerId)))
      throw new BadRequestException('Choose a printer that is in use');
    if (stockItemId && !(await this.jobs.activeReel(stockItemId)))
      throw new BadRequestException('Choose a reel that is in stock');
  }

  /** What a product's pieces really cost to print, from its finished runs. */
  async productCost(productId: string): Promise<ProductRealCost> {
    const [totals, taxRate] = await Promise.all([
      this.jobs.productTotals(productId),
      this.jobs.salesTaxRate(),
    ]);
    return realCostPerPiece(totals, taxRate);
  }

  /**
   * What a finished job cost, with today's prices: its filament (grams × the material's price
   * per gram), its electricity (hours × the printer's watts, at the shop's rate per kWh) and
   * the printer's wear (hours × its price over its life hours).
   */
  private async costs(
    job: PrintJobRow,
    data: PrintJobChange,
    actualGrams: string,
    actualHours: string,
  ): Promise<PrintJobChange> {
    const reelId = data.stockItemId ?? job.stockItemId!;
    const printerId = data.printerId ?? job.printerId!;
    const [reel, printer, rate] = await Promise.all([
      this.prisma.stockItem.findUniqueOrThrow({
        where: { id: reelId },
        select: { material: { select: { pricePerGram: true } } },
      }),
      this.prisma.printer.findUniqueOrThrow({ where: { id: printerId } }),
      this.jobs.electricityPerKwh(),
    ]);
    const grams = new Prisma.Decimal(actualGrams);
    const hours = new Prisma.Decimal(actualHours);
    const kwh = hours.times(printer.watts).div(1000);
    const wearPerHour =
      printer.priceUsd && printer.lifeHours
        ? printer.priceUsd.div(printer.lifeHours)
        : new Prisma.Decimal(0);
    return {
      actualGrams,
      actualHours,
      finishedAt: new Date(),
      materialCost: grams.times(reel.material.pricePerGram).toFixed(2),
      electricityKwh: kwh.toFixed(3),
      electricityCost: kwh.times(rate ?? 0).toFixed(2),
      wearCost: hours.times(wearPerHour).toFixed(2),
    };
  }

  /** On the calendar while scheduled or printing with a date; off once finished or cancelled. */
  private async syncCalendar(job: PrintJobRow): Promise<PrintJobRow> {
    const onCalendar =
      job.scheduledDate !== null &&
      (job.status === PrintJobStatus.SCHEDULED ||
        job.status === PrintJobStatus.PRINTING);
    try {
      if (onCalendar) {
        const start = job.scheduledDate!;
        const what = job.orderItem?.name ?? 'print';
        const eventId = await this.calendar.upsert(job.calendarEventId, {
          summary: `Print ${job.order.orderNumber} · ${what} · ${job.printer?.name ?? ''}`,
          description: `${job.quantity} × ${what}: about ${job.grams.toString()} g of ${
            job.stockItem
              ? `${job.stockItem.material.code} ${job.stockItem.colour}`
              : 'filament'
          }, ${job.hours.toString()} h.`,
          start,
          end: new Date(start.getTime() + Number(job.hours) * HOUR_MS),
        });
        if (eventId !== job.calendarEventId) {
          await this.jobs.setCalendarEvent(job.id, eventId);
          return { ...job, calendarEventId: eventId };
        }
      } else if (job.calendarEventId) {
        await this.calendar.remove(job.calendarEventId);
        await this.jobs.setCalendarEvent(job.id, null);
        return { ...job, calendarEventId: null };
      }
    } catch (error) {
      this.logger.warn(
        `Calendar sync failed for job ${job.id}: ${String(error)}`,
      );
    }
    return job;
  }
}

type Amount = string | number | Prisma.Decimal;

/** Totals over a product's finished runs, per piece printed. */
export function realCostPerPiece(
  t: {
    done: number;
    failed: number;
    pieces: number;
    grams: Amount;
    hours: Amount;
    material: Amount;
    electricity: Amount;
    wear: Amount;
    /** What customers paid for the pieces: after discounts, tax included. */
    sold: Amount;
  },
  taxRatePercent: Amount | null = null,
): ProductRealCost {
  const per = (v: Amount, places = 2) =>
    new Prisma.Decimal(v).div(t.pieces).toFixed(places);
  if (t.pieces === 0)
    return { done: t.done, failed: t.failed, pieces: 0, perPiece: null };
  const total = new Prisma.Decimal(t.material)
    .plus(t.electricity)
    .plus(t.wear)
    .div(t.pieces);
  // Prices include the sales tax, which isn't the studio's money.
  const sold = new Prisma.Decimal(t.sold);
  const net =
    taxRatePercent === null || new Prisma.Decimal(taxRatePercent).isZero()
      ? sold
      : sold.times(100).div(new Prisma.Decimal(100).plus(taxRatePercent));
  const soldAt = net.div(t.pieces);
  return {
    done: t.done,
    failed: t.failed,
    pieces: t.pieces,
    perPiece: {
      grams: per(t.grams, 1),
      hours: per(t.hours),
      material: per(t.material),
      electricity: per(t.electricity),
      wear: per(t.wear),
      total: total.toFixed(2),
      soldAt: soldAt.toFixed(2),
      margin: soldAt.minus(total).toFixed(2),
    },
  };
}

function toItem(j: PrintJobRow): PrintJobListItem {
  const parts = [j.materialCost, j.electricityCost, j.wearCost];
  return {
    id: j.id,
    orderId: j.orderId,
    orderNumber: j.order.orderNumber,
    item: j.orderItem,
    printer: j.printer ? { id: j.printer.id, name: j.printer.name } : null,
    reel: j.stockItem
      ? {
          id: j.stockItem.id,
          material: j.stockItem.material.code,
          colour: j.stockItem.colour,
        }
      : null,
    quantity: j.quantity,
    grams: j.grams.toString(),
    hours: j.hours.toString(),
    actualGrams: j.actualGrams?.toString() ?? null,
    actualHours: j.actualHours?.toString() ?? null,
    cost: parts.every((p) => p !== null)
      ? {
          material: j.materialCost!.toFixed(2),
          electricityKwh: j.electricityKwh?.toString() ?? '0',
          electricity: j.electricityCost!.toFixed(2),
          wear: j.wearCost!.toFixed(2),
          total: j
            .materialCost!.plus(j.electricityCost!)
            .plus(j.wearCost!)
            .toFixed(2),
        }
      : null,
    scheduledDate: j.scheduledDate?.toISOString() ?? null,
    status: j.status,
    createdAt: j.createdAt.toISOString(),
    finishedAt: j.finishedAt?.toISOString() ?? null,
  };
}
