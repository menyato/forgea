import { Injectable } from '@nestjs/common';
import { PRINT_JOB_WASTES_MATERIAL, type PrintJobCounts } from '@forgea/types';
import type { PrintJobListQuery } from '@forgea/validation';
import { dateRange } from '../common/pagination/date-range.js';
import { keysetPage } from '../common/pagination/keyset.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
  type PrintJobStatus,
  StockMovementKind,
} from '../generated/prisma/enums.js';
import { StockRepository } from '../stock/stock.repository.js';

const withRefs = {
  order: { select: { orderNumber: true } },
  material: { select: { code: true } },
} as const satisfies Prisma.PrintJobInclude;
export type PrintJobRow = Prisma.PrintJobGetPayload<{
  include: typeof withRefs;
}>;

export interface NewPrintJob {
  orderId: string;
  materialId: string;
  color: string;
  grams: string;
  hours: string;
  machine: string;
  scheduledDate: Date | null;
  status: PrintJobStatus;
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
      ...(query.machine ? { machine: query.machine } : {}),
      ...(scheduled ? { scheduledDate: scheduled } : {}),
      ...(query.q
        ? {
            OR: [
              {
                order: {
                  orderNumber: { contains: query.q, mode: 'insensitive' },
                },
              },
              { machine: { contains: query.q, mode: 'insensitive' } },
              { color: { contains: query.q, mode: 'insensitive' } },
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

  /** Jobs per status and per machine, in two grouped counts. */
  async counts(): Promise<PrintJobCounts> {
    const [byStatus, byMachine] = await Promise.all([
      this.prisma.printJob.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.printJob.groupBy({ by: ['machine'], _count: { _all: true } }),
    ]);
    return {
      statuses: Object.fromEntries(
        byStatus.map((g) => [g.status, g._count._all]),
      ),
      machines: Object.fromEntries(
        byMachine.map((g) => [g.machine, g._count._all]),
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
   * both win). A failed print takes its grams out of stock (its material and colour), in the
   * same transaction. Null when the job changed meanwhile.
   */
  update(
    id: string,
    from: PrintJobStatus,
    data: {
      status?: PrintJobStatus;
      scheduledDate?: Date | null;
      machine?: string;
    },
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
      if (data.status && PRINT_JOB_WASTES_MATERIAL.includes(data.status)) {
        // Rounded up (a started gram is a used gram). A finished print changes nothing: its
        // order took the filament out of stock when it went into production.
        await this.stock.record(tx, [
          {
            materialId: job.materialId,
            colour: job.color.trim(),
            kind: StockMovementKind.FAILED_PRINT,
            grams: -Math.ceil(Number(job.grams)),
            printJobId: job.id,
            note: `Failed print on ${job.machine} (order ${job.order.orderNumber})`,
          },
        ]);
      }
      return job;
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
}
