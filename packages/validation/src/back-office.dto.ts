import {
  AccountType,
  ActivityKind,
  PaymentMethod,
  QuotationStatus,
} from '@forgea/types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  EMAIL_MAX_LENGTH,
  ENTRY_SORTS,
  INVOICE_FILTERS,
  INVOICE_SORTS,
  LEAD_SORTS,
  MONEY_PATTERN,
  PERCENT_PATTERN,
  PHONE_PATTERN,
  QUOTATION_SORTS,
  SIZE_CM_PATTERN,
} from './constants.js';
import { CommaList, NormalizeEmail, QueryBoolean, Trim } from './email.js';
import { CursorPageQuery } from './pagination.dto.js';

const money = { message: 'Enter an amount, e.g. 12.50' };
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const day = { message: 'Enter a date' };

// CRM ---------------------------------------------------------------------

export class SaveLeadStageDto {
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder: number = 0;

  @IsBoolean()
  isWon: boolean = false;

  /** Leads move here when one of their quotations is sent. */
  @IsBoolean()
  isQuoted: boolean = false;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  defaultProbability!: number;

  @IsBoolean()
  active: boolean = true;
}

export class SaveLostReasonDto {
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsBoolean()
  active: boolean = true;
}

/** A lead the team adds or edits (calls, fairs, referrals…). */
export class SaveLeadDto {
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @IsOptional()
  @Trim()
  @Matches(PHONE_PATTERN, { message: 'Enter a valid phone number' })
  phone?: string;

  @Trim()
  @IsString()
  @MinLength(2, { message: 'What is it about?' })
  @MaxLength(4000)
  message!: string;

  @IsOptional()
  @Matches(MONEY_PATTERN, money)
  expectedRevenue?: string;

  @IsOptional()
  @Matches(DATE_ONLY, day)
  deadline?: string;

  @IsOptional()
  @IsUUID()
  assignedToId?: string;
}

export class MoveLeadDto {
  @IsUUID()
  stageId!: string;
}

export class LoseLeadDto {
  @IsUUID()
  lostReasonId!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class AddActivityDto {
  @IsIn(Object.values(ActivityKind))
  kind!: ActivityKind;

  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  summary!: string;

  @IsISO8601({ strict: true })
  dueAt!: string;

  @IsOptional()
  @IsUUID()
  assignedToId?: string;
}

export class AddNoteDto {
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}

/** The customer declines a quotation: why, if they want to say. */
export class DeclineQuotationDto {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export const LEAD_STATES = ['open', 'won', 'lost'] as const;

export class LeadListQuery extends CursorPageQuery {
  @IsOptional()
  @IsIn(LEAD_SORTS)
  sort: (typeof LEAD_SORTS)[number] = 'createdAt';

  @IsOptional()
  @IsUUID()
  stageId?: string;

  /** Default: open leads only. */
  @IsOptional()
  @IsIn(LEAD_STATES)
  state: (typeof LEAD_STATES)[number] = 'open';

  /** Only leads nobody in the team has opened yet (the "New" tab). */
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  unopened?: boolean;

  @IsOptional()
  @IsUUID()
  assignedToId?: string;

  /** Name or email. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}

// Sales -------------------------------------------------------------------

const sizeMessage = { message: 'A size in cm, e.g. 12.5' };

export class QuotationLineDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  description!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  quantity!: number;

  @Matches(MONEY_PATTERN, money)
  unitPrice!: string;

  @IsOptional()
  @Matches(PERCENT_PATTERN, { message: 'A discount from 0 to 100%' })
  discountPercent: string = '0';

  @IsBoolean()
  isCustom: boolean = false;

  /** The printed size in cm (width × depth × height): all three, or none. */
  @IsOptional()
  @Matches(SIZE_CM_PATTERN, sizeMessage)
  sizeXcm?: string;

  @IsOptional()
  @Matches(SIZE_CM_PATTERN, sizeMessage)
  sizeYcm?: string;

  @IsOptional()
  @Matches(SIZE_CM_PATTERN, sizeMessage)
  sizeZcm?: string;
}

export class SaveQuotationDto {
  /** Who it is for: an account is not needed, the quotation is emailed to this address. */
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter the email of the customer' })
  @MaxLength(EMAIL_MAX_LENGTH)
  customerEmail!: string;

  @IsOptional()
  @IsUUID()
  leadId?: string;

  @Matches(DATE_ONLY, day)
  validUntil!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  customerName!: string;

  @Trim()
  @Matches(PHONE_PATTERN, { message: 'Enter a valid phone number' })
  phone!: string;

  @IsIn(Object.values(PaymentMethod))
  paymentMethod!: PaymentMethod;

  @IsBoolean()
  delivery!: boolean;

  @ValidateIf((o: SaveQuotationDto) => o.delivery)
  @Trim()
  @IsString()
  @MinLength(2, { message: 'Enter the city or area' })
  @MaxLength(100)
  city?: string;

  @ValidateIf((o: SaveQuotationDto) => o.delivery)
  @Trim()
  @IsString()
  @MinLength(5, { message: 'Enter a street, building and floor' })
  @MaxLength(300)
  addressLine?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one line' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => QuotationLineDto)
  lines!: QuotationLineDto[];
}

export class QuotationListQuery extends CursorPageQuery {
  @IsOptional()
  @IsIn(QUOTATION_SORTS)
  sort: (typeof QUOTATION_SORTS)[number] = 'createdAt';

  @IsOptional()
  @IsIn(Object.values(QuotationStatus))
  status?: QuotationStatus;

  /** Several statuses, comma-separated (the dashboard's filters). */
  @IsOptional()
  @CommaList()
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(Object.values(QuotationStatus), { each: true })
  statuses?: QuotationStatus[];

  /** Number or customer email. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}

// Accounting --------------------------------------------------------------

export class SaveAccountDto {
  @Trim()
  @Matches(/^[0-9]{3,8}$/, { message: 'A number of 3 to 8 digits, e.g. 6100' })
  code!: string;

  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsIn(Object.values(AccountType))
  type!: AccountType;

  @IsBoolean()
  active: boolean = true;
}

export class RecordPaymentDto {
  /** The invoice it pays (its open amount is settled first). */
  @IsUUID()
  invoiceId!: string;

  /** USD. */
  @Matches(MONEY_PATTERN, money)
  @Matches(/[1-9]/, { message: 'More than 0' })
  amount!: string;

  @IsIn(['CASH', 'BANK'])
  method!: 'CASH' | 'BANK';

  @Matches(DATE_ONLY, day)
  date!: string;
}

export class ManualLineDto {
  @IsUUID()
  accountId!: string;

  @Trim()
  @IsString()
  @MaxLength(200)
  label: string = '';

  @Matches(MONEY_PATTERN, money)
  debit: string = '0';

  @Matches(MONEY_PATTERN, money)
  credit: string = '0';
}

/** A manual journal entry: opening balances, an expense paid, a correction. */
export class ManualEntryDto {
  @Matches(DATE_ONLY, day)
  date!: string;

  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  label!: string;

  @IsArray()
  @ArrayMinSize(2, { message: 'An entry has at least two lines' })
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ManualLineDto)
  lines!: ManualLineDto[];
}

export class UpdateAccountingSettingsDto {
  /** The tax included in shop prices; null for none. */
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  salesTaxId!: string | null;

  /** Nothing on or before this date can be posted; null for no lock. */
  @ValidateIf((_o, v) => v !== null)
  @Matches(DATE_ONLY, day)
  lockDate!: string | null;
}

export class ReportPeriodQuery {
  @IsOptional()
  @Matches(DATE_ONLY, day)
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, day)
  to?: string;
}

export class InvoiceListQuery extends CursorPageQuery {
  @IsOptional()
  @IsIn(INVOICE_SORTS)
  sort: (typeof INVOICE_SORTS)[number] = 'date';

  @IsOptional()
  @CommaList()
  @IsArray()
  @ArrayMaxSize(INVOICE_FILTERS.length)
  @IsIn(INVOICE_FILTERS, { each: true })
  filters?: (typeof INVOICE_FILTERS)[number][];

  /** Number, order number, customer name or email. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class EntryListQuery extends CursorPageQuery {
  @IsOptional()
  @IsIn(ENTRY_SORTS)
  sort: (typeof ENTRY_SORTS)[number] = 'date';

  @IsOptional()
  @IsIn(['INVOICE', 'CREDIT_NOTE', 'PAYMENT', 'ENTRY'])
  type?: 'INVOICE' | 'CREDIT_NOTE' | 'PAYMENT' | 'ENTRY';

  /** Number, label, order number, customer email or journal. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsUUID()
  orderId?: string;
}
