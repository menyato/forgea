import { CustomRequestStatus, PrintJobStatus, Role } from '@forgea/types';
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
  CUSTOM_UPLOAD_CEILING_MB,
  EMAIL_MAX_LENGTH,
  MONEY_PATTERN,
  PERCENT_PATTERN,
  POSITIVE_DECIMAL,
  REQUEST_DESCRIPTION_MAX_LENGTH,
  REQUEST_QUANTITY_MAX,
  REQUEST_TITLE_MAX_LENGTH,
  STATUS_NOTE_MAX_LENGTH,
  STORAGE_KEY_PATTERN,
} from './constants.js';
import { NormalizeEmail, Trim } from './email.js';
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

  @Matches(POSITIVE_DECIMAL, { message: 'Enter a multiplier, e.g. 2.5' })
  markupMultiplier!: string;

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
}

const TEAM_ROLES = [Role.STAFF, Role.DESIGNER, Role.ADMIN] as const;

/** Adds a Workspace account to the team; they sign in with Google the first time. */
export class AddTeamMemberDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
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
  @IsIn(Object.values(CustomRequestStatus))
  status?: CustomRequestStatus;

  /** Request number, title or customer email. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}

/** A print run for an order on one machine (the production planner). */
export class CreatePrintJobDto {
  @IsUUID()
  orderId!: string;

  @IsUUID()
  materialId!: string;

  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  color!: string;

  @Matches(POSITIVE_DECIMAL, { message: 'Grams, more than 0, e.g. 60' })
  grams!: string;

  @Matches(POSITIVE_DECIMAL, { message: 'Hours, more than 0, e.g. 3.5' })
  hours!: string;

  @Trim()
  @IsString()
  @MinLength(1, { message: 'Which printer?' })
  @MaxLength(50)
  machine!: string;

  /** When it starts (ISO 8601); unset = waiting in the queue. */
  @IsOptional()
  @IsISO8601({ strict: true })
  scheduledDate?: string;
}

/** Move a job along the board, or (re)schedule it; null unschedules it. */
export class UpdatePrintJobDto {
  @IsOptional()
  @IsIn(Object.values(PrintJobStatus))
  status?: PrintJobStatus;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsISO8601({ strict: true })
  scheduledDate?: string | null;

  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  machine?: string;
}
