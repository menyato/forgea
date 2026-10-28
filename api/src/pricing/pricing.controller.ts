import { Body, Controller, Get, Put } from '@nestjs/common';
import type { OrderSettings } from '@forgea/pricing';
import { UpdatePricingSettingsDto } from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import { CurrentUser, Public, Roles } from '../authorization/decorators.js';
import { Role } from '../generated/prisma/enums.js';
import type { PricingSettingsSnapshot } from './pricing-settings.repository.js';
import { PricingService } from './pricing.service.js';

@Controller('pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  /** Public: lets the storefront recalculate totals live. Cost settings are never returned. */
  @Public()
  @Get('order-settings')
  orderSettings(): Promise<OrderSettings> {
    return this.pricing.publicOrderSettings();
  }

  /** Admin only: the full settings, costs and markup included. */
  @Roles(Role.ADMIN)
  @Get('settings')
  settings(): Promise<PricingSettingsSnapshot> {
    return this.pricing.settings();
  }

  /** Admin only, audit-logged: the next quote uses the new numbers. */
  @Roles(Role.ADMIN)
  @Audit({
    action: 'settings.pricing.update',
    targetType: 'PricingSettings',
    targetId: 'pricing',
  })
  @Put('settings')
  update(
    @Body() dto: UpdatePricingSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PricingSettingsSnapshot> {
    return this.pricing.update(dto, user.id);
  }
}
