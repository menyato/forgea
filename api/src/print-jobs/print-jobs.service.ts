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
  type PrintJobListItem,
} from '@forgea/types';
import type {
  CreatePrintJobDto,
  PrintJobListQuery,
  UpdatePrintJobDto,
} from '@forgea/validation';
import { toPage } from '../common/pagination/keyset.js';
import { PrintJobStatus } from '../generated/prisma/enums.js';
import { GoogleCalendar } from '../google/google-calendar.js';
import {
  PrintJobsRepository,
  type PrintJobRow,
} from './print-jobs.repository.js';

const HOUR_MS = 3_600_000;

/**
 * The production planner: print runs per order, scheduled on machines, moved along the board.
 * Scheduled jobs are mirrored on the studio's Google Calendar; a calendar failure is logged
 * and never undoes the change made here.
 */
@Injectable()
export class PrintJobsService {
  private readonly logger = new Logger(PrintJobsService.name);

  constructor(
    private readonly jobs: PrintJobsRepository,
    private readonly calendar: GoogleCalendar,
  ) {}

  async list(query: PrintJobListQuery): Promise<Page<PrintJobListItem>> {
    return toPage(await this.jobs.list(query), toItem);
  }

  async create(dto: CreatePrintJobDto): Promise<PrintJobListItem> {
    if (!(await this.jobs.orderExists(dto.orderId))) {
      throw new NotFoundException('Order not found');
    }
    const job = await this.jobs.create({
      orderId: dto.orderId,
      materialId: dto.materialId,
      color: dto.color,
      grams: dto.grams,
      hours: dto.hours,
      machine: dto.machine,
      scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : null,
      status: dto.scheduledDate
        ? PrintJobStatus.SCHEDULED
        : PrintJobStatus.QUEUED,
    });
    return toItem(await this.syncCalendar(job));
  }

  async update(id: string, dto: UpdatePrintJobDto): Promise<PrintJobListItem> {
    const job = await this.jobs.findById(id);
    if (!job) throw new NotFoundException('Print job not found');
    const data: {
      status?: PrintJobStatus;
      scheduledDate?: Date | null;
      machine?: string;
    } = {};
    if (dto.machine !== undefined) data.machine = dto.machine;
    if (dto.scheduledDate !== undefined) {
      data.scheduledDate =
        dto.scheduledDate === null ? null : new Date(dto.scheduledDate);
      // Putting a waiting job on the calendar schedules it; taking it off puts it back.
      if (job.status === PrintJobStatus.QUEUED && data.scheduledDate) {
        data.status = PrintJobStatus.SCHEDULED;
      } else if (
        job.status === PrintJobStatus.SCHEDULED &&
        data.scheduledDate === null
      ) {
        data.status = PrintJobStatus.QUEUED;
      }
    }
    if (dto.status !== undefined && dto.status !== job.status) {
      if (!PRINT_JOB_FLOW[job.status].includes(dto.status)) {
        throw new BadRequestException(
          `A job that is ${job.status.toLowerCase()} can't become ${dto.status.toLowerCase()}`,
        );
      }
      data.status = dto.status;
    }
    const updated = await this.jobs.update(id, job.status, data);
    if (!updated) {
      throw new ConflictException(
        'Someone else just changed this job. Reload and try again.',
      );
    }
    return toItem(await this.syncCalendar(updated));
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
        const eventId = await this.calendar.upsert(job.calendarEventId, {
          summary: `Print ${job.order.orderNumber} · ${job.machine}`,
          description: `${job.grams.toString()} g of ${job.material.code}, ${job.color}. About ${job.hours.toString()} h.`,
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

function toItem(j: PrintJobRow): PrintJobListItem {
  return {
    id: j.id,
    orderId: j.orderId,
    orderNumber: j.order.orderNumber,
    material: j.material.code,
    color: j.color,
    grams: j.grams.toString(),
    hours: j.hours.toString(),
    machine: j.machine,
    scheduledDate: j.scheduledDate?.toISOString() ?? null,
    status: j.status,
    createdAt: j.createdAt.toISOString(),
  };
}
