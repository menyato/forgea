import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { ModelFileInfoService } from './model-file-info.js';
import { ProductConfigurator } from './product-configurator.js';
import { ProductsController } from './products.controller.js';
import { ProductsRepository } from './products.repository.js';
import { ProductsService } from './products.service.js';
import { TextStudioModule } from '../text-studio/text-studio.module.js';

@Module({
  imports: [DatabaseModule, PricingModule, UploadsModule, TextStudioModule],
  controllers: [ProductsController],
  providers: [
    ProductsService,
    ProductsRepository,
    ProductConfigurator,
    ModelFileInfoService,
  ],
  // The cart configures and prices products the same way the product page does.
  exports: [
    ProductsRepository,
    ProductConfigurator,
    ProductsService,
    // Quotations and custom requests read 3MF files the same way.
    ModelFileInfoService,
  ],
})
export class ProductsModule {}
