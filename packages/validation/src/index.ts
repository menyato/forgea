// class-transformer's @Type reads decorator metadata while these classes are defined,
// so the polyfill must load first — here, for every consumer, whatever its import order.
import 'reflect-metadata';
export * from './constants.js';
export { normalizeEmail, NormalizeEmail, Trim } from './email.js';
export {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateProfileDto,
  ConfirmEmailDto,
  ResendEmailCodeDto,
} from './auth.dto.js';
export { CreateLeadDto } from './leads.dto.js';
export { AddCurrencyDto, SetExchangeRateDto } from './currency.dto.js';
export {
  AuditLogListQuery,
  CursorPageQuery,
  OrderListQuery,
  PrintJobListQuery,
  ProductListQuery,
} from './pagination.dto.js';
export {
  AcceptQuoteDto,
  AddCartItemDto,
  CheckoutDto,
  UpdateCartItemDto,
} from './checkout.dto.js';
export { ChangeOrderStatusDto, MyOrdersQuery } from './orders.dto.js';
export { UpdateStoreSettingsDto } from './settings.dto.js';
export {
  AddTeamMemberDto,
  BulkDiscountTierDto,
  CloseCustomRequestDto,
  CreateCustomRequestDto,
  CreatePrintJobDto,
  CustomRequestListQuery,
  EstimateRequestDto,
  QuoteCustomRequestDto,
  ApplyThemeDto,
  SaveNamedThemeDto,
  SaveRolePermissionsDto,
  SaveSiteThemeDto,
  SaveTeamAccessDto,
  SetHomePlateDto,
  UpdatePricingSettingsDto,
  UpdatePrintJobDto,
  UpdateQuotationEmailDto,
  UpdateRequestSettingsDto,
  UpdateTeamMemberDto,
  UserListQuery,
} from './dashboard.dto.js';
export {
  OptionSelectionDto,
  PricePreviewDto,
  ProductOptionConfigDto,
  ProductPriceDto,
  ProductSizeDto,
  SaveCategoryDto,
  SaveMaterialDto,
  SaveOptionGroupDto,
  SaveOptionValueDto,
  SaveProductDto,
} from './catalog.dto.js';
export {
  AddActivityDto,
  AddNoteDto,
  CustomerEmailQuery,
  CustomerListQuery,
  DeclineQuotationDto,
  EntryListQuery,
  InvoiceListQuery,
  LEAD_STATES,
  LeadListQuery,
  LoseLeadDto,
  ManualEntryDto,
  ManualLineDto,
  MoveLeadDto,
  QuotationLineDto,
  QuotationListQuery,
  RecordPaymentDto,
  ReportPeriodQuery,
  SaveAccountDto,
  SaveLeadDto,
  SaveLeadStageDto,
  SaveLostReasonDto,
  SaveQuotationDto,
  UpdateAccountingSettingsDto,
} from './back-office.dto.js';
export { PeriodQuery } from './insights.dto.js';
export {
  PURCHASE_PAID_FROM,
  type PurchasePaidFrom,
  ReceiveSpoolsDto,
  RecordStockMovementDto,
  SaveStockItemDto,
  StockCountDto,
  StockMovementListQuery,
  StudioPrintDto,
} from './stock.dto.js';
export {
  DesignLetterDto,
  ProductTextDto,
  SaveFontDto,
  TEXT_MAX_CHARS,
  DesignMeasurementDto,
  TextDesignDto,
  UpdateFontDto,
} from './text-studio.dto.js';
