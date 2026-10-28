import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PHONE_PATTERN } from './constants.js';
import { Trim } from './email.js';

/** Admin edits the shop's contact and payment settings. */
export class UpdateStoreSettingsDto {
  /** Customers send "transfer" payments to this number. */
  @Trim()
  @Matches(PHONE_PATTERN, { message: 'Enter a valid phone number' })
  transferPhone!: string;

  /** Optional, e.g. "Whish or OMT — put your order number in the note". */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(300)
  transferInstructions?: string;

  @Trim()
  @Matches(PHONE_PATTERN, { message: 'Enter a valid phone number' })
  whatsappPhone!: string;
}
