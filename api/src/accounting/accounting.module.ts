import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AccountingController } from './accounting.controller.js';
import { Books } from './books.service.js';
import { Invoicing } from './invoicing.service.js';
import { Ledger } from './ledger.service.js';

/** Double-entry accounting (Phase 11): invoices, payments, the books and reports. */
@Module({
  imports: [DatabaseModule],
  controllers: [AccountingController],
  providers: [Ledger, Invoicing, Books],
  // Orders invoice themselves as they move along (deposit received, delivered).
  // The business page reuses the profit and loss.
  exports: [Invoicing, Books],
})
export class AccountingModule {}
