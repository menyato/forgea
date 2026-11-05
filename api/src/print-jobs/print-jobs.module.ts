import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { GoogleModule } from '../google/google.module.js';
import { StockModule } from '../stock/stock.module.js';
import {
  PrintersController,
  PrintJobsController,
} from './print-jobs.controller.js';
import { PrintJobsRepository } from './print-jobs.repository.js';
import { PrintJobsService } from './print-jobs.service.js';
import { PrintersService } from './printers.service.js';

/** Production: print jobs and the printers they run on. */
@Module({
  imports: [DatabaseModule, GoogleModule, StockModule],
  controllers: [PrintJobsController, PrintersController],
  providers: [PrintJobsService, PrintJobsRepository, PrintersService],
  // An order going into production makes its jobs.
  exports: [PrintJobsService],
})
export class PrintJobsModule {}
