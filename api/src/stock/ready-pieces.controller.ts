import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import type { ReadyPieceDetail, ReadyPieceView } from '@forgea/types';
import {
  AddReadyPiecesDto,
  CountReadyPiecesDto,
  TakeReadyPiecesDto,
} from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import { CurrentUser, RequirePermission } from '../authorization/decorators.js';
import { ReadyPiecesService } from './ready-pieces.service.js';

/** Pieces printed and not sold yet: seen with the stock, changed with `stock.manage`. Audited. */
@Controller('ready-pieces')
export class ReadyPiecesController {
  constructor(private readonly pieces: ReadyPiecesService) {}

  /** On the shelf now; `?all=true` also lists the kinds there are none of. */
  @RequirePermission('materials.view')
  @Get()
  list(@Query('all') all: string | undefined): Promise<ReadyPieceView[]> {
    return this.pieces.list(all === 'true');
  }

  @RequirePermission('materials.view')
  @Get(':id')
  one(@Param('id', ParseUUIDPipe) id: string): Promise<ReadyPieceDetail> {
    return this.pieces.one(id);
  }

  @RequirePermission('stock.manage')
  @Audit({
    action: 'ready-pieces.add',
    targetType: 'ReadyPiece',
    targetId: 'shelf',
  })
  @HttpCode(204)
  @Post()
  add(
    @Body() dto: AddReadyPiecesDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.pieces.add(dto, user.id);
  }

  @RequirePermission('stock.manage')
  @Audit({ action: 'ready-pieces.take', targetType: 'ReadyPiece' })
  @HttpCode(200)
  @Post(':id/take')
  take(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TakeReadyPiecesDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReadyPieceDetail> {
    return this.pieces.take(id, dto, user.id);
  }

  @RequirePermission('stock.manage')
  @Audit({ action: 'ready-pieces.count', targetType: 'ReadyPiece' })
  @HttpCode(200)
  @Post(':id/count')
  count(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CountReadyPiecesDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReadyPieceDetail> {
    return this.pieces.count(id, dto, user.id);
  }
}
