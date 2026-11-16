import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module.js';
import { PiecesController } from './pieces.controller.js';
import { PiecesService } from './pieces.service.js';

/**
 * The "Where it is" board. Its repository is provided by the stock module, whose studio prints
 * (and the print runs it serves) add pieces to it.
 */
@Module({
  imports: [StockModule],
  controllers: [PiecesController],
  providers: [PiecesService],
})
export class PiecesModule {}
