import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { LeadsModule } from '../leads/leads.module.js';
import { MailModule } from '../mail/mail.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { StoreSettingsModule } from '../store-settings/store-settings.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { CustomerFilesService } from './customer-files.service.js';
import { UnusedFilesCleaner } from './unused-files-cleaner.js';
import { CustomRequestsController } from './custom-requests.controller.js';
import { CustomRequestsRepository } from './custom-requests.repository.js';
import { CustomRequestsService } from './custom-requests.service.js';
import { RequestEstimator } from './request-estimator.js';

/** "Make me something": requests, instant estimates, quotes, and orders from accepted quotes. */
@Module({
  imports: [
    DatabaseModule,
    OrdersModule,
    PricingModule,
    StoreSettingsModule,
    UploadsModule,
    MailModule,
    LeadsModule,
  ],
  controllers: [CustomRequestsController],
  providers: [
    CustomRequestsService,
    CustomRequestsRepository,
    RequestEstimator,
    CustomerFilesService,
    UnusedFilesCleaner,
  ],
})
export class CustomRequestsModule {}
