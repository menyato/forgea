import { OrderStatus } from '@forgea/types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { STATUS_NOTE_MAX_LENGTH } from './constants.js';
import { Trim } from './email.js';
import { CursorPageQuery } from './pagination.dto.js';

/** Staff move an order to its next status; the note is shown to the customer. */
export class ChangeOrderStatusDto {
  @IsIn(Object.values(OrderStatus))
  status!: OrderStatus;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(STATUS_NOTE_MAX_LENGTH)
  note?: string;

  /** The status the page showed: the change is refused if someone changed it since. */
  @IsOptional()
  @IsIn(Object.values(OrderStatus))
  expectedStatus?: OrderStatus;
}

/** "My Orders": newest first, paged. */
export class MyOrdersQuery extends CursorPageQuery {}

/** Removing a test order: its number typed again, as a confirmation. */
export class RemoveTestOrderDto {
  @Trim()
  @IsString()
  @MaxLength(40)
  confirm!: string;
}

/** A colour of a 3MF order line and the reel it prints from. */
export class OrderFilamentDto {
  @IsString()
  @MaxLength(80)
  colour!: string;

  @IsUUID()
  stockItemId!: string;
}

export class OrderLineFilamentsDto {
  @IsUUID()
  orderItemId!: string;

  @IsArray()
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => OrderFilamentDto)
  colours!: OrderFilamentDto[];
}

/** PUT /orders/:id/filaments: the reels each 3MF line's colours print from. */
export class SaveOrderFilamentsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderLineFilamentsDto)
  lines!: OrderLineFilamentsDto[];
}
