import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { StockModule } from '../stock/stock.module.js';
import { MaterialsController } from './materials.controller.js';
import { MaterialsRepository } from './materials.repository.js';
import { MaterialsService } from './materials.service.js';

/** Materials with their price per gram, density, print throughput and stock. */
@Module({
  imports: [DatabaseModule, StockModule],
  controllers: [MaterialsController],
  // The catalog importer reuses the same service, so imported data meets the same rules.
  exports: [MaterialsService],
  providers: [MaterialsService, MaterialsRepository],
})
export class MaterialsModule {}
