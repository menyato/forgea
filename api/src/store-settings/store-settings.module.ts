import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { StoreSettingsController } from './store-settings.controller.js';
import { StoreSettingsRepository } from './store-settings.repository.js';
import { StoreSettingsService } from './store-settings.service.js';

/** Shop-wide contact and payment settings: the transfer number and WhatsApp number. */
@Module({
  imports: [DatabaseModule],
  controllers: [StoreSettingsController],
  providers: [StoreSettingsService, StoreSettingsRepository],
  exports: [StoreSettingsService],
})
export class StoreSettingsModule {}
