import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Trim } from './email.js';

/** A free offer as the dashboard saves it (the API checks the dates and the product). */
export class SaveFreeOfferDto {
  @IsUUID('all', { message: 'Choose the product' })
  productId!: string;

  @Trim()
  @IsString()
  @MinLength(1, { message: 'Write what the banner says' })
  @MaxLength(80)
  title!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(300)
  description?: string;

  @Type(() => Date)
  @IsDate({ message: 'Choose when it starts' })
  startsAt!: Date;

  @Type(() => Date)
  @IsDate({ message: 'Choose when it ends' })
  endsAt!: Date;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'A whole number of pieces' })
  @Min(1)
  @Max(100000)
  maxClaims?: number;

  @IsBoolean()
  active!: boolean;
}
