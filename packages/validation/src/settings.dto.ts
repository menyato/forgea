import { IsPhone } from './phone.js';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Trim } from './email.js';

/** Admin edits the shop's contact and payment settings. */
export class UpdateStoreSettingsDto {
  /** Customers send "transfer" payments to this number. */
  @Trim()
  @IsPhone()
  transferPhone!: string;

  /** Optional, e.g. "Whish or OMT — put your order number in the note". */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(300)
  transferInstructions?: string;

  @Trim()
  @IsPhone()
  whatsappPhone!: string;
}

/** Settings → Delivery areas: one per line, 1 to 80, each 2-60 characters, no repeats. */
export class DeliveryAreasDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Keep at least one area' })
  @ArrayMaxSize(80)
  @ArrayUnique((a: string) => a.trim().toLowerCase(), {
    message: 'Each area once',
  })
  @IsString({ each: true })
  @MinLength(2, { each: true, message: 'An area needs a name' })
  @MaxLength(60, { each: true })
  areas!: string[];
}
