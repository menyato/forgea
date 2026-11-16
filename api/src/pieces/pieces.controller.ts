import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type {
  Page,
  PieceCounts,
  PieceDetail,
  PieceHolderAccount,
  PieceView,
} from '@forgea/types';
import {
  FinishPieceDto,
  PieceListQuery,
  UpdatePieceDto,
} from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import { CurrentUser, RequirePermission } from '../authorization/decorators.js';
import { PiecesService } from './pieces.service.js';

/**
 * "Where it is" (Dashboard → Pieces): everyone who sees the stock sees every print and where
 * it is; moving pieces and finishing prints needs `stock.manage`. Audited.
 */
@Controller('pieces')
export class PiecesController {
  constructor(private readonly pieces: PiecesService) {}

  @RequirePermission('materials.view')
  @Get()
  list(@Query() query: PieceListQuery): Promise<Page<PieceView>> {
    return this.pieces.list(query);
  }

  /** Pieces per stage and the totals, under the other filters. */
  @RequirePermission('materials.view')
  @Get('counts')
  counts(@Query() query: PieceListQuery): Promise<PieceCounts> {
    return this.pieces.counts(query);
  }

  /** Everyone with an account, to say who holds a piece (moving pieces needs stock.manage). */
  @RequirePermission('stock.manage')
  @Get('holders')
  holders(): Promise<(PieceHolderAccount & { team: boolean })[]> {
    return this.pieces.accounts();
  }

  @RequirePermission('materials.view')
  @Get(':id')
  one(@Param('id', ParseUUIDPipe) id: string): Promise<PieceDetail> {
    return this.pieces.one(id);
  }

  @RequirePermission('stock.manage')
  @Audit({ action: 'piece.update', targetType: 'Piece' })
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePieceDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PieceDetail> {
    return this.pieces.update(id, dto, user.id);
  }

  /** A print still on the printer: done (filament off the shelf) or failed. */
  @RequirePermission('stock.manage')
  @Audit({ action: 'piece.finish', targetType: 'Piece' })
  @Post(':id/finish')
  finish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FinishPieceDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PieceDetail> {
    return this.pieces.finish(id, dto, user.id);
  }
}
