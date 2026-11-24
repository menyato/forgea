import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import type { CurrentFreeOffer, FreeOfferView } from '@forgea/types';
import { SaveFreeOfferDto } from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import { Public, RequirePermission } from '../authorization/decorators.js';
import { OffersService } from './offers.service.js';

/** Free offers: the shop's banner reads the one running; the owner sets them up. */
@Controller('offers')
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  /** Public: the offer running now (null when none), for the banner and the product page. */
  @Public()
  @Get('current')
  current(): Promise<CurrentFreeOffer | null> {
    return this.offers.current();
  }

  @RequirePermission('offers.manage')
  @Get()
  list(): Promise<FreeOfferView[]> {
    return this.offers.list();
  }

  @RequirePermission('offers.manage')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<FreeOfferView> {
    return this.offers.get(id);
  }

  @RequirePermission('offers.manage')
  @Audit({ action: 'offer.create', targetType: 'FreeOffer' })
  @Post()
  create(@Body() dto: SaveFreeOfferDto): Promise<FreeOfferView> {
    return this.offers.create(dto);
  }

  @RequirePermission('offers.manage')
  @Audit({ action: 'offer.update', targetType: 'FreeOffer' })
  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveFreeOfferDto,
  ): Promise<FreeOfferView> {
    return this.offers.update(id, dto);
  }
}
