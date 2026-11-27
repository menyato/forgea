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
import type {
  FilamentChoice,
  Page,
  StockMovementCounts,
  StockMovementView,
  StockOverview,
  StockPrintable,
} from '@forgea/types';
import {
  CreateStockItemDto,
  MoveStockMovementDto,
  StockSweepDto,
  PeriodQuery,
  ReceiveSpoolsDto,
  RecordStockMovementDto,
  SaveStockItemDto,
  StockCountDto,
  VendorPurchaseDto,
  StockMovementListQuery,
  StudioPrintDto,
} from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import { CurrentUser, RequirePermission } from '../authorization/decorators.js';
import { StockService } from './stock.service.js';
import { studioDay, studioDayPlus } from '../common/studio-day.js';

const today = () => studioDay();
const daysAgo = (days: number) => studioDayPlus(today(), -days);

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

  /** The filaments in use, for forms that choose one. */
  @RequirePermission('materials.view')
  @Get('filaments')
  filaments(): Promise<FilamentChoice[]> {
    return this.stock.filaments(today());
  }

  /** Every movement, newest first (or one line's), searchable and paged. */
  @RequirePermission('materials.view')
  @Get('movements')
  movements(
    @Query() q: StockMovementListQuery,
  ): Promise<Page<StockMovementView>> {
    return this.stock.movements(q);
  }

  @RequirePermission('materials.view')
  @Get('movements/counts')
  movementCounts(
    @Query('stockItemId', new ParseUUIDPipe({ optional: true }))
    stockItemId?: string,
  ): Promise<StockMovementCounts> {
    return this.stock.movementCounts(stockItemId);
  }

  /** One movement: what it was for (each to open) and where it was moved from. */
  @RequirePermission('materials.view')
  @Get('movements/:id')
  movement(@Param('id', ParseUUIDPipe) id: string): Promise<StockMovementView> {
    return this.stock.movement(id);
  }

  /** Recorded on the wrong filament: put on the one it really was. */
  @RequirePermission('stock.manage')
  @Audit({ action: 'stock.movement.move', targetType: 'StockMovement' })
  @HttpCode(200)
  @Post('movements/:id/move')
  move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveStockMovementDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StockMovementView> {
    return this.stock.move(id, dto.stockItemId, user.id);
  }

  /** Every filament weighed at once: each difference recorded as a correction. */
  @RequirePermission('stock.manage')
  @Audit({ action: 'stock.sweep', targetType: 'Material', targetId: 'stock' })
  @HttpCode(200)
  @Post('sweeps')
  sweep(
    @Body() dto: StockSweepDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ corrected: number; difference: number }> {
    return this.stock.sweep(dto, user.id);
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

  /** Spools received, with their price (the material's cost; booked when paid). */
  @RequirePermission('stock.manage')
  @Audit({ action: 'stock.receive', targetType: 'Material', targetId: 'stock' })
  @HttpCode(204)
  @Post('receipts')
  receive(
    @Body() dto: ReceiveSpoolsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.stock.receive(dto, user.id);
  }

  /** A vendor's bill of filament: its lines on the shelf at their real cost, booked once. */
  @RequirePermission('stock.manage')
  @Audit({
    action: 'stock.vendor-purchase',
    targetType: 'Material',
    targetId: 'stock',
  })
  @HttpCode(200)
  @Post('purchases')
  vendorPurchase(
    @Body() dto: VendorPurchaseDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ total: string; reels: number }> {
    return this.stock.vendorPurchase(dto, user.id);
  }

  /** The products the studio can print for itself, with one's grams and cost. */
  @RequirePermission('stock.manage')
  @Get('printables')
  printables(): Promise<StockPrintable[]> {
    return this.stock.printables();
  }

  /** Pieces printed for the studio: the product's filament comes off the shelf. */
  @RequirePermission('stock.manage')
  @Audit({
    action: 'stock.studio-print',
    targetType: 'Product',
    targetId: 'stock',
  })
  @HttpCode(200)
  @Post('studio-prints')
  studioPrint(
    @Body() dto: StudioPrintDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ grams: number; cost: string; pieceId: string | null }> {
    return this.stock.studioPrint(dto, false, user.id);
  }

  /** A failed print of a product: the filament it used, as far as it got, is lost. */
  @RequirePermission('stock.manage')
  @Audit({
    action: 'stock.failed-print',
    targetType: 'Product',
    targetId: 'stock',
  })
  @HttpCode(200)
  @Post('failed-prints')
  failedPrint(
    @Body() dto: StudioPrintDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ grams: number; cost: string; pieceId: string | null }> {
    return this.stock.studioPrint(dto, true, user.id);
  }

  /** The spools weighed: the difference is recorded. */
  @RequirePermission('stock.manage')
  @Audit({ action: 'stock.count', targetType: 'Material', targetId: 'stock' })
  @HttpCode(200)
  @Post('counts')
  count(
    @Body() dto: StockCountDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ difference: number }> {
    return this.stock.count(dto, user.id);
  }

  @RequirePermission('stock.manage')
  @Audit({ action: 'stock.item.create', targetType: 'StockItem' })
  @Post('items')
  createItem(@Body() dto: CreateStockItemDto): Promise<{ id: string }> {
    return this.stock.createItem(dto);
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
