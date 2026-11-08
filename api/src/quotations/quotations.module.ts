import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { LeadsModule } from '../leads/leads.module.js';
import { MailModule } from '../mail/mail.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { ProductsModule } from '../products/products.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { StoreSettingsModule } from '../store-settings/store-settings.module.js';
import { QuotationPrintFiles } from './quotation-print-files.js';
import { QuotationsController } from './quotations.controller.js';
import { QuotationsRepository } from './quotations.repository.js';
import { QuotationsService } from './quotations.service.js';

/** Sales quotations (Phase 11): written by the team, confirmed into orders. */
@Module({
  imports: [
    DatabaseModule,
    OrdersModule,
    MailModule,
    StoreSettingsModule,
    LeadsModule,
    PricingModule,
    ProductsModule,
    UploadsModule,
  ],
  controllers: [QuotationsController],
  providers: [QuotationsService, QuotationsRepository, QuotationPrintFiles],
})
export class QuotationsModule {}
