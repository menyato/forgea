import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { StockModule } from '../stock/stock.module.js';
import { InsightsController } from './insights.controller.js';
import { InsightsRepository } from './insights.repository.js';
import { InsightsService } from './insights.service.js';

/** The business dashboard: profit, sales and what they used, by period. */
@Module({
  imports: [DatabaseModule, AccountingModule, StockModule],
  controllers: [InsightsController],
  providers: [InsightsService, InsightsRepository],
})
export class InsightsModule {}
