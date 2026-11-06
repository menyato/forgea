import {
  type ManualStockMovement,
  MANUAL_STOCK_MOVEMENTS,
  READY_PIECE_TAKE_KINDS,
  StockMovementKind,
} from '@forgea/types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  NotEquals,
  Validate,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import {
  MONEY_PATTERN,
  ORDER_NUMBER_PATTERN,
  STOCK_COLOUR_MAX_LENGTH,
  STOCK_GRAMS_MAX,
  STOCK_MOVEMENT_SORTS,
} from './constants.js';
import { CommaList, Trim } from './email.js';
import { CursorPageQuery } from './pagination.dto.js';

const grams = { message: 'Enter whole grams, e.g. 1000' };

/** A delivery or a use is a number of grams (the API takes a use out); a correction is signed. */
@ValidatorConstraint({ name: 'gramsForKind' })
class GramsForKind implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const kind = (args.object as RecordStockMovementDto).kind;
    return kind === 'CORRECTION' || (typeof value === 'number' && value > 0);
  }

  defaultMessage(): string {
    return 'Enter how many grams came in or went out';
  }
}

/**
 * Filament in or out, recorded by the team: a delivery, filament used for something else, or
 * a count after weighing the spools (the difference, + or −). The material and colour's stock
 * line is created on its first movement.
 */
export class RecordStockMovementDto {
  @IsUUID('all', { message: 'Choose a material' })
  materialId!: string;

  /** As the shop names the colour; empty when it doesn't matter. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(STOCK_COLOUR_MAX_LENGTH)
  colour: string = '';

  @IsIn(MANUAL_STOCK_MOVEMENTS)
  kind!: ManualStockMovement;

  /** Always positive for a delivery or a use; a correction is signed. */
  @Type(() => Number)
  @IsInt(grams)
  @Max(STOCK_GRAMS_MAX, grams)
  @Min(-STOCK_GRAMS_MAX, grams)
  @NotEquals(0, { message: 'Enter how many grams' })
  @Validate(GramsForKind)
  grams!: number;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  note?: string;
}

/** The owner's limits for one filament: when to restock and how much to buy. */
export class SaveStockItemDto {
  @Type(() => Number)
  @IsInt(grams)
  @Min(0, grams)
  @Max(STOCK_GRAMS_MAX, grams)
  lowStockGrams!: number;

  @Type(() => Number)
  @IsInt(grams)
  @Min(1, grams)
  @Max(STOCK_GRAMS_MAX, grams)
  spoolGrams!: number;

  @Type(() => Number)
  @IsInt({ message: 'Enter whole days' })
  @Min(0)
  @Max(365)
  leadTimeDays!: number;

  @Type(() => Number)
  @IsInt({ message: 'Enter whole days' })
  @Min(0)
  @Max(365)
  coverDays!: number;

  @IsBoolean()
  active!: boolean;
}

const note = { message: 'At most 200 characters' };

/** Where a delivery was paid from: the cash box or a money transfer; none = not booked. */
export const PURCHASE_PAID_FROM = ['CASH', 'BANK'] as const;
export type PurchasePaidFrom = (typeof PURCHASE_PAID_FROM)[number];

/**
 * Spools received: how many, how much each holds and what each cost. The grams go on the
 * shelf; the price gives the material its cost per gram (when `updateCost`); paid from cash
 * or a transfer, it is booked as an expense.
 */
export class ReceiveSpoolsDto {
  @IsUUID('all', { message: 'Choose a material' })
  materialId!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(STOCK_COLOUR_MAX_LENGTH)
  colour: string = '';

  @Type(() => Number)
  @IsInt({ message: 'Enter how many spools' })
  @Min(1, { message: 'Enter how many spools' })
  @Max(200)
  spools!: number;

  @Type(() => Number)
  @IsInt(grams)
  @Min(50, grams)
  @Max(20_000, grams)
  spoolGrams!: number;

  @Matches(MONEY_PATTERN, {
    message: 'Enter the price of one spool, e.g. 19.50',
  })
  pricePerSpool!: string;

  @IsOptional()
  @IsIn(PURCHASE_PAID_FROM)
  paidFrom?: PurchasePaidFrom;

  /** Use this price for the material's cost per gram (pricing) from now on. */
  @IsBoolean()
  updateCost: boolean = true;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200, note)
  note?: string;
}

/**
 * Pieces the studio printed for itself (samples, display, gifts, stock made ahead) or that
 * failed: the product, its size and colour as the shop offers them, how many. The grams and
 * cost come from the product's own figures; a failure counts only how far it got.
 */
export class StudioPrintDto {
  @IsUUID('all', { message: 'Choose a product' })
  productId!: string;

  /** One of the product's sizes, by measurements; none = its own size. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(60)
  size?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(STOCK_COLOUR_MAX_LENGTH)
  colour?: string;

  @Type(() => Number)
  @IsInt({ message: 'Enter how many' })
  @Min(1, { message: 'Enter how many' })
  @Max(500)
  quantity!: number;

  /** Printed to sell: the pieces go to the ready pieces. */
  @IsOptional()
  @IsBoolean()
  toShelf?: boolean;

  /** A failure: how far it printed before it failed. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Enter a percentage, e.g. 40' })
  @Min(1, { message: 'Enter a percentage, e.g. 40' })
  @Max(100, { message: 'Enter a percentage, e.g. 40' })
  progressPercent?: number;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200, note)
  note?: string;
}

/** The spools weighed: what is on the shelf now; the difference is recorded. */
export class StockCountDto {
  @IsUUID('all', { message: 'Choose a material' })
  materialId!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(STOCK_COLOUR_MAX_LENGTH)
  colour: string = '';

  @Type(() => Number)
  @IsInt(grams)
  @Min(0, grams)
  @Max(STOCK_GRAMS_MAX, grams)
  gramsOnShelf!: number;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200, note)
  note?: string;
}

/** Filament movements, newest first: all of them, or one stock line's. */
export class StockMovementListQuery extends CursorPageQuery {
  @IsOptional()
  @IsIn(STOCK_MOVEMENT_SORTS)
  sort: (typeof STOCK_MOVEMENT_SORTS)[number] = 'createdAt';

  @IsOptional()
  @IsUUID()
  stockItemId?: string;

  /** Several kinds, comma-separated (the dashboard's filters). */
  @IsOptional()
  @CommaList()
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(Object.values(StockMovementKind), { each: true })
  kinds?: StockMovementKind[];

  /** Material, colour, note, order number, product or who recorded it. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}

/** Pieces put on the shelf by hand (printed outside the planner, a custom design kept). */
export class AddReadyPiecesDto {
  @IsOptional()
  @IsUUID('all', { message: 'Choose a product' })
  productId?: string;

  /** Required without a product (a custom design's name). */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(300)
  details?: string;

  @Type(() => Number)
  @IsInt({ message: 'Enter how many' })
  @Min(1, { message: 'Enter how many' })
  @Max(10000)
  quantity!: number;

  @Matches(MONEY_PATTERN, { message: 'What one cost to make, e.g. 3.20' })
  unitCost!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Pieces off the shelf: sold, given away or scrapped. */
export class TakeReadyPiecesDto {
  @IsIn(READY_PIECE_TAKE_KINDS)
  kind!: (typeof READY_PIECE_TAKE_KINDS)[number];

  @Type(() => Number)
  @IsInt({ message: 'Enter how many' })
  @Min(1, { message: 'Enter how many' })
  @Max(10000)
  quantity!: number;

  /** Sold in an order: its number. */
  @IsOptional()
  @Trim()
  @Matches(ORDER_NUMBER_PATTERN, {
    message: 'An order number, e.g. FG-2026-0012',
  })
  orderNumber?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** The shelf counted: how many there really are. */
export class CountReadyPiecesDto {
  @Type(() => Number)
  @IsInt({ message: 'Enter how many there are' })
  @Min(0)
  @Max(100000)
  counted!: number;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  note?: string;
}
