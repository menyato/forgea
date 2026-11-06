import { OrderStatus } from '@forgea/types';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
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
