import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { CurrenciesController } from './currencies.controller.js';
import { CurrenciesRepository } from './currencies.repository.js';
import { CurrenciesService } from './currencies.service.js';

/** Currencies and admin-set exchange rates, shared by checkout, invoices and accounting. */
@Module({
  imports: [DatabaseModule],
  controllers: [CurrenciesController],
  providers: [CurrenciesService, CurrenciesRepository],
  exports: [CurrenciesService],
})
export class CurrenciesModule {}
