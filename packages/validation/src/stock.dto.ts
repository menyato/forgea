import {
  type ManualStockMovement,
  MANUAL_STOCK_MOVEMENTS,
} from '@forgea/types';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  NotEquals,
  Validate,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { STOCK_COLOUR_MAX_LENGTH, STOCK_GRAMS_MAX } from './constants.js';
import { Trim } from './email.js';

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
