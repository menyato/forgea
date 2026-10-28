import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { ProductConfigurator } from './product-configurator.js';
import { ProductsController } from './products.controller.js';
import { ProductsRepository } from './products.repository.js';
import { ProductsService } from './products.service.js';

@Module({
  imports: [DatabaseModule, PricingModule, UploadsModule],
  controllers: [ProductsController],
  providers: [ProductsService, ProductsRepository, ProductConfigurator],
  // The cart configures and prices products the same way the product page does.
  exports: [ProductsRepository, ProductConfigurator, ProductsService],
})
export class ProductsModule {}
