import { Body, Controller, Get, Put } from '@nestjs/common';
import type { StoreSettings } from '@forgea/types';
import {
  UpdateRequestSettingsDto,
  UpdateStoreSettingsDto,
} from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import { CurrentUser, Public, Roles } from '../authorization/decorators.js';
import { Role } from '../generated/prisma/enums.js';
import { StoreSettingsService } from './store-settings.service.js';

@Controller('store-settings')
export class StoreSettingsController {
  constructor(private readonly storeSettings: StoreSettingsService) {}

  /** Public: checkout shows the transfer number, every page links to WhatsApp. */
  @Public()
  @Get()
  get(): Promise<StoreSettings> {
    return this.storeSettings.get();
  }

  /** Admin only: where customers send money is a financial setting. Audit-logged. */
  @Roles(Role.ADMIN)
  @Audit({
    action: 'store-settings.update',
    targetType: 'StoreSettings',
    targetId: 'store',
  })
  @Put()
  update(
    @Body() dto: UpdateStoreSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StoreSettings> {
    return this.storeSettings.update(dto, user.id);
  }

  /** Admin only: quote validity, deposit refunds, upload limit, estimate rules. Audit-logged. */
  @Roles(Role.ADMIN)
  @Audit({
    action: 'store-settings.requests.update',
    targetType: 'StoreSettings',
    targetId: 'store',
  })
  @Put('custom-requests')
  updateRequestRules(
    @Body() dto: UpdateRequestSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StoreSettings> {
    return this.storeSettings.updateRequestRules(dto, user.id);
  }
}
