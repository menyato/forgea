import { Injectable } from '@nestjs/common';
import { PRINT_JOB_USES_MATERIAL } from '@forgea/types';
import type { PrintJobListQuery } from '@forgea/validation';
import { dateRange } from '../common/pagination/date-range.js';
import { keysetPage } from '../common/pagination/keyset.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrintJobStatus } from '../generated/prisma/enums.js';

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
  constructor(private readonly prisma: PrismaService) {}

  list(query: PrintJobListQuery) {
    const scheduled = dateRange(query.scheduledFrom, query.scheduledTo);
    const where: Prisma.PrintJobWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.machine ? { machine: query.machine } : {}),
      ...(scheduled ? { scheduledDate: scheduled } : {}),
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
   * both win). Finishing or failing a print takes its grams out of the material's stock, in
   * the same transaction. Null when the job changed meanwhile.
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
      if (data.status && PRINT_JOB_USES_MATERIAL.includes(data.status)) {
        // Rounded up (a started gram is a used gram), and never below 0: stock records that
        // are behind must not stop a finished print from being recorded.
        const used = Math.ceil(Number(job.grams));
        await tx.$executeRaw`UPDATE "materials" SET "stockGrams" = GREATEST("stockGrams" - ${used}, 0) WHERE "id" = ${job.materialId}::uuid`;
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
