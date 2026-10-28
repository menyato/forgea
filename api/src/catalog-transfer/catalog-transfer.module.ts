import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module.js';
import { MaterialsModule } from '../materials/materials.module.js';
import { ProductOptionsModule } from '../product-options/product-options.module.js';
import { ProductsModule } from '../products/products.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { CatalogExporter } from './catalog-exporter.service.js';
import { CatalogImporter } from './catalog-importer.service.js';
import { CatalogTransferController } from './catalog-transfer.controller.js';

/** Catalog export and import (one JSON file), also used by the seed and the CLI script. */
@Module({
  imports: [
    CategoriesModule,
    MaterialsModule,
    ProductOptionsModule,
    ProductsModule,
    UploadsModule,
  ],
  controllers: [CatalogTransferController],
  providers: [CatalogExporter, CatalogImporter],
})
export class CatalogTransferModule {}
