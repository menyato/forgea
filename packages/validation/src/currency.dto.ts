import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { POSITIVE_RATE } from './constants.js';
import { Trim } from './email.js';

/** Admin sets a new exchange rate: units of this currency per 1 unit of the base currency. */
export class SetExchangeRateDto {
  @Matches(POSITIVE_RATE, { message: 'Enter a positive rate, e.g. 89500' })
  rate!: string;
}

/** A currency customers may pay in, with its first rate (units per 1 US dollar). */
export class AddCurrencyDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]{3}$/, { message: 'Its three-letter code, e.g. EUR' })
  code!: string;

  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  /** Decimal places shown and stored: 2 for euros, 0 for Lebanese pounds. */
  @Type(() => Number)
  @IsInt({ message: 'A whole number from 0 to 4' })
  @Min(0, { message: 'A whole number from 0 to 4' })
  @Max(4, { message: 'A whole number from 0 to 4' })
  decimals!: number;

  /** The smallest amount cash can pay, e.g. 0.01, or 5000 for Lebanese pounds. */
  @Matches(POSITIVE_RATE, { message: 'A positive amount, e.g. 0.01' })
  roundingStep!: string;

  @Matches(POSITIVE_RATE, { message: 'Enter a positive rate, e.g. 0.92' })
  rate!: string;
}
