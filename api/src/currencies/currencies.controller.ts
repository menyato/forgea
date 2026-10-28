import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { SetExchangeRateDto } from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import { CurrentUser, Public, Roles } from '../authorization/decorators.js';
import { Role } from '../generated/prisma/enums.js';
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

  /** Admin only: the rates set so far, for the dashboard. */
  @Roles(Role.ADMIN)
  @Get(':code/rates')
  history(@Param('code') code: string): Promise<ExchangeRateEntry[]> {
    return this.currencies.history(code.toUpperCase());
  }

  /** Admin only (a financial setting): append a new rate. Audit-logged. */
  @Roles(Role.ADMIN)
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
