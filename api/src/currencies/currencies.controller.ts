import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { AddCurrencyDto, SetExchangeRateDto } from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import {
  CurrentUser,
  Public,
  RequirePermission,
} from '../authorization/decorators.js';
import type { CurrencyQuote, ExchangeRateEntry } from '@forgea/types';
import { CurrenciesService } from './currencies.service.js';

@Controller('currencies')
export class CurrenciesController {
  constructor(private readonly currencies: CurrenciesService) {}

  /** Public: the storefront shows prices in every accepted currency. */
  @Public()
  @Get()
  list(): Promise<CurrencyQuote[]> {
    return this.currencies.list();
  }

  /** A currency customers may also pay in, with its first rate. Audit-logged. */
  @RequirePermission('currencies.manage')
  @Audit({ action: 'currency.add', targetType: 'Currency', resultKey: 'code' })
  @Post()
  add(
    @Body() dto: AddCurrencyDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CurrencyQuote> {
    return this.currencies.add(dto, user.id);
  }

  /** Admin only: the rates set so far, for the dashboard. */
  @RequirePermission('currencies.manage')
  @Get(':code/rates')
  history(@Param('code') code: string): Promise<ExchangeRateEntry[]> {
    return this.currencies.history(code.toUpperCase());
  }

  /** Admin only (a financial setting): append a new rate. Audit-logged. */
  @RequirePermission('currencies.manage')
  @Audit({
    action: 'currency.rate.set',
    targetType: 'Currency',
    resultKey: 'code',
  })
  @Put(':code/rate')
  setRate(
    @Param('code') code: string,
    @Body() dto: SetExchangeRateDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CurrencyQuote> {
    return this.currencies.setRate(code.toUpperCase(), dto.rate, user.id);
  }
}
