import { Body, Controller, Get, Put } from '@nestjs/common';
import type { QuotationEmailSettings, StoreSettings } from '@forgea/types';
import {
  UpdateQuotationEmailDto,
  DeliveryAreasDto,
  UpdateRequestSettingsDto,
  UpdateStoreSettingsDto,
} from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import {
  CurrentUser,
  Public,
  RequirePermission,
} from '../authorization/decorators.js';
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
  @RequirePermission('store.manage')
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

  /** Where the studio delivers: checkout and quotations offer only these. Audit-logged. */
  @RequirePermission('store.manage')
  @Audit({
    action: 'store-settings.delivery-areas.update',
    targetType: 'StoreSettings',
    targetId: 'store',
  })
  @Put('delivery-areas')
  updateDeliveryAreas(
    @Body() dto: DeliveryAreasDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StoreSettings> {
    return this.storeSettings.updateDeliveryAreas(dto.areas, user.id);
  }

  /** Admin only: quote validity, deposit refunds, upload limit, estimate rules. Audit-logged. */
  @RequirePermission('store.manage')
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

  @RequirePermission('store.manage')
  @Get('quotation-email')
  quotationEmail(): Promise<QuotationEmailSettings> {
    return this.storeSettings.quotationEmail();
  }

  /** The quotation email's wording. Audit-logged. */
  @RequirePermission('store.manage')
  @Audit({
    action: 'store-settings.quotation-email.update',
    targetType: 'StoreSettings',
    targetId: 'store',
  })
  @Put('quotation-email')
  updateQuotationEmail(
    @Body() dto: UpdateQuotationEmailDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuotationEmailSettings> {
    return this.storeSettings.updateQuotationEmail(dto, user.id);
  }
}
