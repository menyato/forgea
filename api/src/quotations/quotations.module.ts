import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { MailModule } from '../mail/mail.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { StoreSettingsModule } from '../store-settings/store-settings.module.js';
import { QuotationsController } from './quotations.controller.js';
import { QuotationsRepository } from './quotations.repository.js';
import { QuotationsService } from './quotations.service.js';

/** Sales quotations (Phase 11): written by the team, confirmed into orders. */
@Module({
  imports: [DatabaseModule, OrdersModule, MailModule, StoreSettingsModule],
  controllers: [QuotationsController],
  providers: [QuotationsService, QuotationsRepository],
})
export class QuotationsModule {}
