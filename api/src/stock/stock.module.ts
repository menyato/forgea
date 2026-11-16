import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PiecesRepository } from '../pieces/pieces.repository.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { OrderStock } from './order-stock.service.js';
import { ProductionEstimator } from './production-estimator.js';
import { ReadyPiecesController } from './ready-pieces.controller.js';
import { ReadyPiecesRepository } from './ready-pieces.repository.js';
import { ReadyPiecesService } from './ready-pieces.service.js';
import { StockController } from './stock.controller.js';
import { StockRepository } from './stock.repository.js';
import { StockService } from './stock.service.js';

/** Filament stock per material and colour, kept as an append-only list of movements. */
@Module({
  imports: [DatabaseModule, PricingModule, AccountingModule],
  controllers: [StockController, ReadyPiecesController],
  providers: [
    StockRepository,
    StockService,
    ProductionEstimator,
    OrderStock,
    ReadyPiecesRepository,
    ReadyPiecesService,
    PiecesRepository,
  ],
  // Orders take their filament when they go into production; print jobs record failed
  // prints; materials record their opening stock; the business page estimates costs.
  exports: [
    OrderStock,
    StockRepository,
    StockService,
    ProductionEstimator,
    ReadyPiecesRepository,
    PiecesRepository,
  ],
})
export class StockModule {}
