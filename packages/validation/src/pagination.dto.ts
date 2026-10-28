import { OrderStatus, PrintJobStatus } from '@forgea/types';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Trim } from './email.js';
import {
  AUDIT_LOG_SORTS,
  ORDER_SORTS,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  PRINT_JOB_SORTS,
  PRODUCT_SORTS,
  SLUG_PATTERN,
  SORT_ORDERS,
  type SortOrder,
} from './constants.js';

/**
 * Query string shared by every list endpoint: an opaque cursor from the previous page,
 * a page size and a direction. Each list adds its own sort fields and filters below.
 */
export class CursorPageQuery {
  /** `nextCursor` from the previous page; omit for the first page. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'cursor is not valid' })
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGE_SIZE_MAX)
  limit: number = PAGE_SIZE_DEFAULT;

  @IsOptional()
  @IsIn(SORT_ORDERS)
  order: SortOrder = 'desc';
}

const SEARCH = () => [Trim(), IsOptional(), IsString(), MaxLength(100)];
const apply =
  (...decorators: PropertyDecorator[]): PropertyDecorator =>
  (target, key) => {
    for (const d of decorators) d(target, key);
  };

export class ProductListQuery extends CursorPageQuery {
  @IsOptional()
  @IsIn(PRODUCT_SORTS)
  sort: (typeof PRODUCT_SORTS)[number] = 'createdAt';

  /** Matches the product name. */
  @apply(...SEARCH())
  q?: string;

  /** Material code, e.g. "PLA". */
  @IsOptional()
  @Matches(/^[A-Z0-9-]{2,20}$/)
  material?: string;

  /** Category slug, e.g. "home-desk". */
  @IsOptional()
  @Matches(SLUG_PATTERN)
  category?: string;
}

export class OrderListQuery extends CursorPageQuery {
  @IsOptional()
  @IsIn(ORDER_SORTS)
  sort: (typeof ORDER_SORTS)[number] = 'createdAt';

  @IsOptional()
  @IsIn(Object.values(OrderStatus))
  status?: OrderStatus;

  /** Placed on or after (ISO 8601). */
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  /** Placed before (ISO 8601). */
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  /** Order number or customer email. */
  @apply(...SEARCH())
  q?: string;
}

export class PrintJobListQuery extends CursorPageQuery {
  @IsOptional()
  @IsIn(PRINT_JOB_SORTS)
  sort: (typeof PRINT_JOB_SORTS)[number] = 'createdAt';

  @IsOptional()
  @IsIn(Object.values(PrintJobStatus))
  status?: PrintJobStatus;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(50)
  machine?: string;

  /** Scheduled on or after (ISO 8601) — the production calendar's visible range. */
  @IsOptional()
  @IsISO8601({ strict: true })
  scheduledFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  scheduledTo?: string;
}

export class AuditLogListQuery extends CursorPageQuery {
  @IsOptional()
  @IsIn(AUDIT_LOG_SORTS)
  sort: (typeof AUDIT_LOG_SORTS)[number] = 'timestamp';

  /** Exact action, e.g. "currency.rate.set". */
  @IsOptional()
  @Matches(/^[a-z_.-]{1,100}$/)
  action?: string;

  @IsOptional()
  @Matches(/^[A-Za-z]{1,50}$/)
  targetType?: string;

  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}
