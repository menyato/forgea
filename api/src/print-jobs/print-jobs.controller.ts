import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type {
  Page,
  PrinterView,
  PrintJobCounts,
  PrintJobListItem,
  ProductRealCost,
} from '@forgea/types';
import {
  CreatePrintJobDto,
  PrintJobListQuery,
  SavePrinterDto,
  UpdatePrintJobDto,
} from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import { CurrentUser, RequirePermission } from '../authorization/decorators.js';
import { PrintJobsService } from './print-jobs.service.js';
import { PrintersService } from './printers.service.js';

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

  /** What a product's pieces really cost to print (dashboard only). */
  @Get('products/:productId/cost')
  productCost(
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<ProductRealCost> {
    return this.jobs.productCost(productId);
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
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PrintJobListItem> {
    return this.jobs.update(id, dto, user.id);
  }
}

/** The studio's printers: chosen on every print job. Staff with production may change them. */
@RequirePermission('production.manage')
@Controller('printers')
export class PrintersController {
  constructor(private readonly printers: PrintersService) {}

  @Get()
  list(): Promise<PrinterView[]> {
    return this.printers.list();
  }

  @Get(':id')
  one(@Param('id', ParseUUIDPipe) id: string): Promise<PrinterView> {
    return this.printers.one(id);
  }

  @Audit({ action: 'printer.create', targetType: 'Printer', resultKey: 'id' })
  @Post()
  create(@Body() dto: SavePrinterDto): Promise<PrinterView> {
    return this.printers.save(null, dto);
  }

  @Audit({ action: 'printer.update', targetType: 'Printer' })
  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SavePrinterDto,
  ): Promise<PrinterView> {
    return this.printers.save(id, dto);
  }
}
