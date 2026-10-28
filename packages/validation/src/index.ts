// class-transformer's @Type reads decorator metadata while these classes are defined,
// so the polyfill must load first — here, for every consumer, whatever its import order.
import 'reflect-metadata';
export * from './constants.js';
export { normalizeEmail, NormalizeEmail, Trim } from './email.js';
export { LoginDto, RegisterDto, VerifyEmailDto } from './auth.dto.js';
export { CreateLeadDto } from './leads.dto.js';
export { SetExchangeRateDto } from './currency.dto.js';
export {
  AuditLogListQuery,
  CursorPageQuery,
  OrderListQuery,
  PrintJobListQuery,
  ProductListQuery,
} from './pagination.dto.js';
export {
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
  SaveSiteThemeDto,
  SetHomePlateDto,
  UpdatePricingSettingsDto,
  UpdatePrintJobDto,
  UpdateRequestSettingsDto,
  UpdateTeamMemberDto,
  UserListQuery,
} from './dashboard.dto.js';
export {
  OptionSelectionDto,
  ProductOptionConfigDto,
  ProductPriceDto,
  SaveCategoryDto,
  SaveMaterialDto,
  SaveOptionGroupDto,
  SaveOptionValueDto,
  SaveProductDto,
} from './catalog.dto.js';
export {
  AddActivityDto,
  AddNoteDto,
  EntryListQuery,
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
