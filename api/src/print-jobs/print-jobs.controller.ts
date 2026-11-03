import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { Page, PrintJobCounts, PrintJobListItem } from '@forgea/types';
import {
  CreatePrintJobDto,
  PrintJobListQuery,
  UpdatePrintJobDto,
} from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import { RequirePermission } from '../authorization/decorators.js';
import { PrintJobsService } from './print-jobs.service.js';

/** The production planner, for staff and admins. Changes are audit-logged. */
@RequirePermission('production.manage')
@Controller('print-jobs')
export class PrintJobsController {
  constructor(private readonly jobs: PrintJobsService) {}

  @Get()
  list(@Query() query: PrintJobListQuery): Promise<Page<PrintJobListItem>> {
    return this.jobs.list(query);
  }

  @Get('counts')
  counts(): Promise<PrintJobCounts> {
    return this.jobs.counts();
  }

  @Get(':id')
  one(@Param('id', ParseUUIDPipe) id: string): Promise<PrintJobListItem> {
    return this.jobs.one(id);
  }

  @Audit({ action: 'print-job.create', targetType: 'PrintJob' })
  @Post()
  create(@Body() dto: CreatePrintJobDto): Promise<PrintJobListItem> {
    return this.jobs.create(dto);
  }

  @Audit({ action: 'print-job.update', targetType: 'PrintJob' })
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePrintJobDto,
  ): Promise<PrintJobListItem> {
    return this.jobs.update(id, dto);
  }
}
