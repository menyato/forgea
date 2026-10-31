import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { GoogleModule } from '../google/google.module.js';
import { StockModule } from '../stock/stock.module.js';
import { PrintJobsController } from './print-jobs.controller.js';
import { PrintJobsRepository } from './print-jobs.repository.js';
import { PrintJobsService } from './print-jobs.service.js';

@Module({
  imports: [DatabaseModule, GoogleModule, StockModule],
  controllers: [PrintJobsController],
  providers: [PrintJobsService, PrintJobsRepository],
})
export class PrintJobsModule {}
