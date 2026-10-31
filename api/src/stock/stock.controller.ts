import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { StockOverview } from '@forgea/types';
import {
  PeriodQuery,
  RecordStockMovementDto,
  SaveStockItemDto,
} from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import { CurrentUser, RequirePermission } from '../authorization/decorators.js';
import { StockService } from './stock.service.js';

const DAY_MS = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (days: number) =>
  new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);

/**
 * Filament stock (Dashboard → Stock): everyone who sees materials sees it; recording
 * deliveries, use and counts and setting the restock limits needs `stock.manage`. Audited.
 */
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  /** Use by product covers `from`–`to`, by default the last 30 days. */
  @RequirePermission('materials.view')
  @Get()
  overview(@Query() q: PeriodQuery): Promise<StockOverview> {
    return this.stock.overview(today(), {
      from: q.from ?? daysAgo(29),
      to: q.to ?? today(),
    });
  }

  @RequirePermission('stock.manage')
  @Audit({
    action: 'stock.movement',
    targetType: 'Material',
    targetId: 'stock',
  })
  @HttpCode(204)
  @Post('movements')
  record(
    @Body() dto: RecordStockMovementDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.stock.record(dto, user.id);
  }

  @RequirePermission('stock.manage')
  @Audit({ action: 'stock.item.update', targetType: 'StockItem' })
  @HttpCode(204)
  @Put('items/:id')
  saveItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveStockItemDto,
  ): Promise<void> {
    return this.stock.saveItem(id, dto);
  }
}
