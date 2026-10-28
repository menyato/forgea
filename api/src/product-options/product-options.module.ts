import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ProductOptionsController } from './product-options.controller.js';
import { ProductOptionsRepository } from './product-options.repository.js';
import { ProductOptionsService } from './product-options.service.js';

/** Option groups (colour, size, text…) and their values with price rules. */
@Module({
  imports: [DatabaseModule],
  controllers: [ProductOptionsController],
  // The catalog importer reuses the same service, so imported data meets the same rules.
  exports: [ProductOptionsService],
  providers: [ProductOptionsService, ProductOptionsRepository],
})
export class ProductOptionsModule {}
