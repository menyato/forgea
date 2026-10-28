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
import { Throttle } from '@nestjs/throttler';
import type {
  CheckoutResult,
  Page,
  QuotationDetail,
  QuotationListItem,
} from '@forgea/types';
import {
  AddNoteDto,
  QuotationListQuery,
  SaveQuotationDto,
} from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import { CurrentUser, Roles } from '../authorization/decorators.js';
import { ParsePatternPipe } from '../custom-requests/parse-pattern.pipe.js';
import { Role } from '../generated/prisma/enums.js';
import { THROTTLE } from '../security/throttle-policies.js';
import { QuotationsService } from './quotations.service.js';

const QuotationNumber = () =>
  Param(
    'number',
    new ParsePatternPipe(/^Q-\d{4}-\d{4,}$/, 'Quotation not found'),
  );

/** Staff write and confirm quotations; the customer sees and accepts their own online. */
@Controller('quotations')
export class QuotationsController {
  constructor(private readonly quotations: QuotationsService) {}

  @Get('mine/:number')
  mine(
    @QuotationNumber() number: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuotationDetail> {
    return this.quotations.mine(user.id, number);
  }

  @Throttle(THROTTLE.checkout)
  @HttpCode(200)
  @Post('mine/:number/accept')
  accept(
    @QuotationNumber() number: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CheckoutResult> {
    return this.quotations.accept(user.id, number);
  }

  @Roles(Role.STAFF)
  @Get()
  list(@Query() query: QuotationListQuery): Promise<Page<QuotationListItem>> {
    return this.quotations.list(query);
  }

  @Roles(Role.STAFF)
  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<QuotationDetail> {
    return this.quotations.detail(id);
  }

  @Roles(Role.STAFF)
  @Audit({ action: 'quotation.create', targetType: 'Quotation' })
  @Post()
  create(
    @Body() dto: SaveQuotationDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuotationDetail> {
    return this.quotations.create(dto, user.id);
  }

  @Roles(Role.STAFF)
  @Audit({ action: 'quotation.update', targetType: 'Quotation' })
  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveQuotationDto,
  ): Promise<QuotationDetail> {
    return this.quotations.update(id, dto);
  }

  @Roles(Role.STAFF)
  @Audit({ action: 'quotation.send', targetType: 'Quotation' })
  @HttpCode(200)
  @Post(':id/send')
  send(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuotationDetail> {
    return this.quotations.send(id, user.id);
  }

  @Roles(Role.STAFF)
  @Audit({ action: 'quotation.confirm', targetType: 'Quotation' })
  @HttpCode(200)
  @Post(':id/confirm')
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CheckoutResult> {
    return this.quotations.confirm(id, user.id);
  }

  @Roles(Role.STAFF)
  @Audit({ action: 'quotation.cancel', targetType: 'Quotation' })
  @HttpCode(200)
  @Post(':id/cancel')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuotationDetail> {
    return this.quotations.cancel(id, user.id, dto.body);
  }
}
