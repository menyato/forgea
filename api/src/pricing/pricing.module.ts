import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { PricingController } from './pricing.controller.js';
import {
  PricingSettingsRepository,
  PrismaPricingSettingsRepository,
} from './pricing-settings.repository.js';
import { PricingService } from './pricing.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [PricingController],
  providers: [
    PricingService,
    {
      provide: PricingSettingsRepository,
      useClass: PrismaPricingSettingsRepository,
    },
  ],
  // Orders/checkout (Phase 5) inject PricingService for the authoritative price.
  exports: [PricingService],
})
export class PricingModule {}
