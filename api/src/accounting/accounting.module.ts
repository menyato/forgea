import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AccountingController } from './accounting.controller.js';
import { Books } from './books.service.js';
import { InvoiceListRepository } from './invoice-list.repository.js';
import { Invoicing } from './invoicing.service.js';
import { Ledger } from './ledger.service.js';
import { Purchases } from './purchases.js';

/** Double-entry accounting (Phase 11): invoices, payments, the books and reports. */
@Module({
  imports: [DatabaseModule],
  controllers: [AccountingController],
  providers: [Ledger, Invoicing, InvoiceListRepository, Books, Purchases],
  // Orders invoice themselves as they move along (deposit received, delivered).
  // The business page reuses the profit and loss.
  // Filament deliveries paid from cash or a transfer are booked as purchases (Stock page).
  exports: [Invoicing, Books, Purchases],
})
export class AccountingModule {}
