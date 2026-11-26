import {
  CustomRequestStatus,
  type Permission,
  PERMISSIONS,
  PrintJobStatus,
  ProfitKind,
  PRICE_LINES,
  type PriceLine,
  Role,
} from '@forgea/types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
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
  CUSTOM_REQUEST_SORTS,
  CUSTOM_UPLOAD_CEILING_MB,
  EMAIL_MAX_LENGTH,
  MONEY_PATTERN,
  PERCENT_PATTERN,
  DECIMAL_PATTERN,
  REQUEST_DESCRIPTION_MAX_LENGTH,
  REQUEST_QUANTITY_MAX,
  REQUEST_TITLE_MAX_LENGTH,
  STATUS_NOTE_MAX_LENGTH,
  STORAGE_KEY_PATTERN,
} from './constants.js';
import { CommaList, NormalizeEmail, Trim, NoEmailTypo } from './email.js';
import { CursorPageQuery } from './pagination.dto.js';

const money = { message: 'Enter an amount, e.g. 12.50' };
const percent = { message: 'Enter a percentage from 0 to 100' };

/** One bulk discount: a cart line of at least `minQuantity` units gets `percent` off. */
export class BulkDiscountTierDto {
  @Type(() => Number)
  @IsInt()
  @Min(2, { message: 'Discounts start at 2 units' })
  @Max(100_000)
  minQuantity!: number;

  @Matches(PERCENT_PATTERN, percent)
  percent!: string;
}

/** Admin edits the pricing engine's settings; the next price quoted uses them. */
export class UpdatePricingSettingsDto {
  @Matches(MONEY_PATTERN, money)
  machineRatePerHour!: string;

  @Matches(PERCENT_PATTERN, percent)
  purgeWastePercent!: string;

  @Matches(PERCENT_PATTERN, percent)
  failureAllowancePercent!: string;

  @Matches(MONEY_PATTERN, money)
  laborCostPerUnit!: string;

  @Matches(MONEY_PATTERN, money)
  packagingCostPerUnit!: string;

  /** The shop's profit on top of cost: a percentage or a fixed amount (USD). */
  @IsIn(Object.values(ProfitKind), {
    message: 'Choose a percentage or a fixed amount',
  })
  profitKind!: ProfitKind;

  @Matches(MONEY_PATTERN, {
    message: 'Enter the profit, e.g. 120 (%) or 4.50 (USD)',
  })
  profitValue!: string;

  /** What shop prices round to, half up (USD): 1.00 = whole dollars. */
  @Matches(/^\d{1,4}(\.\d{1,2})?$/, {
    message: 'Enter what prices round to, e.g. 1.00',
  })
  priceStep!: string;

  /**
   * The printer prices are worked out from: its own price, life and watts (Printers) with
   * `electricityPerKwh`. Empty: machineRatePerHour is typed directly.
   */
  @IsOptional()
  @IsUUID('all', { message: 'Choose a printer' })
  pricingPrinterId?: string;

  @IsOptional()
  @Matches(/^\d{1,4}(\.\d{1,4})?$/, {
    message: 'Enter a price per kWh, e.g. 0.30',
  })
  electricityPerKwh?: string;

  @Matches(PERCENT_PATTERN, percent)
  rushFeePercent!: string;

  @Matches(MONEY_PATTERN, money)
  deliveryFee!: string;

  @Matches(PERCENT_PATTERN, percent)
  depositPercent!: string;

  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => BulkDiscountTierDto)
  bulkDiscountTiers: BulkDiscountTierDto[] = [];
}

/** The custom-request rules the owner decides (docs/CUSTOM_REQUESTS.md). */
export class UpdateRequestSettingsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  quoteValidityDays!: number;

  @IsBoolean()
  depositRefundable!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CUSTOM_UPLOAD_CEILING_MB)
  customUploadMaxMb!: number;

  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(100)
  estimateSolidityPercent!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  estimateSpreadPercent!: number;

  /** A customer's sliced 3MF is quoted at once at its exact price. */
  @IsBoolean()
  autoQuoteSlicedFiles: boolean = true;
}

const TEAM_ROLES = [Role.STAFF, Role.DESIGNER, Role.ADMIN] as const;

/** Adds a Workspace account to the team; they sign in with Google the first time. */
export class AddTeamMemberDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @NoEmailTypo()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsIn(TEAM_ROLES)
  role!: (typeof TEAM_ROLES)[number];
}

/** Changes a team member's role, or switches their access off (and back on). */
export class UpdateTeamMemberDto {
  @IsIn(TEAM_ROLES)
  role!: (typeof TEAM_ROLES)[number];

  @IsBoolean()
  active!: boolean;
}

export class UserListQuery extends CursorPageQuery {
  @IsOptional()
  @IsIn(Object.values(Role))
  role?: Role;

  /** Email or name. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}

/** What stands on the home page's print bed, in order: the first in the centre. */
export class SetHomePlateDto {
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  productIds!: string[];
}

/** The palette picked in the theme editor; the API checks its colours and contrast. */
export class SaveSiteThemeDto {
  @IsObject()
  palette!: Record<string, string>;

  /** The built-in palette it started from. */
  @Matches(/^[a-z]{2,20}$/)
  basedOn!: string;

  /** The owner confirmed saving although some text fails the readability checks. */
  @IsOptional()
  @IsBoolean()
  allowLowContrast?: boolean;
}

/** A palette kept under a name, to switch to later. */
export class SaveNamedThemeDto {
  @Trim()
  @IsString()
  @MinLength(1, { message: 'Give the theme a name' })
  @MaxLength(60)
  name!: string;

  @IsObject()
  palette!: Record<string, string>;

  @Matches(/^[a-z]{2,20}$/)
  basedOn!: string;
}

/** Switching the site to a saved theme; the same readability rule as saving one. */
export class ApplyThemeDto {
  @IsOptional()
  @IsBoolean()
  allowLowContrast?: boolean;
}

/** "Make me something": what the customer describes, with an optional uploaded file. */
export class CreateCustomRequestDto {
  @Trim()
  @IsString()
  @MinLength(3, { message: 'Give it a short title' })
  @MaxLength(REQUEST_TITLE_MAX_LENGTH)
  title!: string;

  @Trim()
  @IsString()
  @MinLength(10, { message: 'Describe what you need in a sentence or two' })
  @MaxLength(REQUEST_DESCRIPTION_MAX_LENGTH)
  description!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(REQUEST_QUANTITY_MAX)
  quantity: number = 1;

  @IsOptional()
  @IsUUID()
  materialId?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(40)
  colour?: string;

  /** An uploaded file (POST /uploads/custom-request), by its object key. */
  @IsOptional()
  @Matches(STORAGE_KEY_PATTERN)
  fileKey?: string;
}

/** The instant price range for an uploaded STL, before the request is sent. */
export class EstimateRequestDto {
  @Matches(STORAGE_KEY_PATTERN)
  fileKey!: string;

  @IsOptional()
  @IsUUID()
  materialId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(REQUEST_QUANTITY_MAX)
  quantity: number = 1;
}

/** The studio's price for a request (USD, all units), with an optional note. */
export class QuoteCustomRequestDto {
  @Matches(MONEY_PATTERN, money)
  @Matches(/[1-9]/, { message: 'A quote must be more than 0' })
  price!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** A cost the owner adds to a request's price (USD, for the whole request). */
export class AddedCostDto {
  @Trim()
  @IsString()
  @MinLength(1, { message: 'Say what the cost is for' })
  @MaxLength(80)
  label!: string;

  @Matches(MONEY_PATTERN, money)
  amount!: string;
}

/** POST /custom-requests/:id/price: the shop's price with lines switched off and costs added. */
export class RequestPriceDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(PRICE_LINES.map((l) => l.key), { each: true })
  off: PriceLine[] = [];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AddedCostDto)
  added: AddedCostDto[] = [];
}

/** Declining (customer), cancelling (either side): a note the other side sees. */
export class CloseCustomRequestDto {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(STATUS_NOTE_MAX_LENGTH)
  note?: string;
}

export class CustomRequestListQuery extends CursorPageQuery {
  @IsOptional()
  @IsIn(CUSTOM_REQUEST_SORTS)
  sort: (typeof CUSTOM_REQUEST_SORTS)[number] = 'createdAt';

  @IsOptional()
  @IsIn(Object.values(CustomRequestStatus))
  status?: CustomRequestStatus;

  /** Several statuses, comma-separated (a dashboard tab). */
  @IsOptional()
  @CommaList()
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(Object.values(CustomRequestStatus), { each: true })
  statuses?: CustomRequestStatus[];

  /** Request number, title or customer email. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}

/** A print run for an order on one machine (the production planner). */
export class CreatePrintJobDto {
  /** The form's one-time key: sent twice, it is recorded once. */
  @IsOptional()
  @IsUUID()
  requestKey?: string;

  @IsUUID()
  orderId!: string;

  /** The order line it prints; leave out for work that isn't one line. */
  @IsOptional()
  @IsUUID()
  orderItemId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'Choose a printer' })
  printerId?: string;

  /** The reel: a material and colour from stock. */
  @IsOptional()
  @IsUUID('all', { message: 'Choose the reel' })
  stockItemId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'At least one piece' })
  @Max(10000)
  quantity: number = 1;

  @Matches(DECIMAL_PATTERN, { message: 'Grams, e.g. 60' })
  grams!: string;

  @Matches(DECIMAL_PATTERN, { message: 'Hours, e.g. 3.5' })
  hours!: string;

  /** When it starts (ISO 8601); unset = waiting in the queue. */
  @IsOptional()
  @IsISO8601({ strict: true })
  scheduledDate?: string;
}

/**
 * A change to a job: its plan (printer, reel, pieces, estimate, date) or its next step. "Done"
 * needs what it really took (actualGrams, actualHours); "Failed" may say the grams lost.
 */
export class UpdatePrintJobDto {
  @IsOptional()
  @IsIn(Object.values(PrintJobStatus))
  status?: PrintJobStatus;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsISO8601({ strict: true })
  scheduledDate?: string | null;

  @IsOptional()
  @IsUUID('all', { message: 'Choose a printer' })
  printerId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'Choose the reel' })
  stockItemId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'At least one piece' })
  @Max(10000)
  quantity?: number;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: 'Grams, e.g. 60' })
  grams?: string;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: 'Hours, e.g. 3.5' })
  hours?: string;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: 'The grams it really took, e.g. 62' })
  actualGrams?: string;

  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: 'The hours it really took, e.g. 3.8' })
  actualHours?: string;

  /** Done: pieces that came out right (default: all of them). */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'How many came out right, e.g. 4' })
  @Min(0)
  @Max(10000)
  goodPieces?: number;

  /** Done: good pieces beyond what it was for (to the ready pieces). */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Spare pieces, a whole number' })
  @Min(0)
  @Max(1000)
  sparePieces?: number;

  /** The energy the printer (or a plug meter) reported; instead of watts × hours. */
  @IsOptional()
  @Matches(DECIMAL_PATTERN, { message: 'kWh, e.g. 0.42' })
  actualKwh?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** Done with pieces missing, or failed: plan a reprint of them (default yes). */
  @IsOptional()
  @IsBoolean()
  reprint?: boolean;
}

/** A printer: Production → Printers. */
export class SavePrinterDto {
  @Trim()
  @IsString()
  @MinLength(1, { message: 'Name the printer' })
  @MaxLength(60)
  name!: string;

  /** Average draw while printing. */
  @Type(() => Number)
  @IsInt({ message: 'Watts, a whole number, e.g. 150' })
  @Min(1)
  @Max(5000)
  watts!: number;

  /** What it cost and the print hours it should last: both or neither (the API checks). */
  @IsOptional()
  @Matches(MONEY_PATTERN, { message: 'An amount, e.g. 699' })
  priceUsd?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Hours, a whole number, e.g. 5000' })
  @Min(1)
  @Max(1000000)
  lifeHours?: number;

  @IsBoolean()
  active: boolean = true;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/** What one role may do (Roles & permissions page). */
export class SaveRolePermissionsDto {
  @IsArray()
  @ArrayMaxSize(PERMISSIONS.length)
  @ArrayUnique()
  @IsIn(PERMISSIONS, { each: true, message: 'Unknown permission' })
  permissions!: Permission[];
}

/** One team member's own changes on top of their role; the API refuses a key in both lists. */
export class SaveTeamAccessDto {
  @IsArray()
  @ArrayMaxSize(PERMISSIONS.length)
  @ArrayUnique()
  @IsIn(PERMISSIONS, { each: true, message: 'Unknown permission' })
  granted!: Permission[];

  @IsArray()
  @ArrayMaxSize(PERMISSIONS.length)
  @ArrayUnique()
  @IsIn(PERMISSIONS, { each: true, message: 'Unknown permission' })
  denied!: Permission[];
}

/** The quotation email in the owner's words; empty means the standard wording. */
export class UpdateQuotationEmailDto {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(150)
  subject?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  intro?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  closing?: string;
}
