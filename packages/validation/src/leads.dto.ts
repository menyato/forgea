import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { NormalizeEmail, Trim } from './email.js';
import {
  BUDGET_RANGES,
  type BudgetRange,
  EMAIL_MAX_LENGTH,
  PHONE_PATTERN,
} from './constants.js';

/** Public custom-design inquiry. The optional reference image arrives as a separate file part. */
export class CreateLeadDto {
  @Trim()
  @IsString()
  @MinLength(1, { message: 'Enter your name' })
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
  @MinLength(10, { message: 'Tell us a little more (at least 10 characters)' })
  @MaxLength(5000)
  message!: string;

  @IsOptional()
  @IsIn(BUDGET_RANGES)
  budgetRange?: BudgetRange;
}
