import { OrderStatus, PrintJobStatus } from '@forgea/types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
import { CommaList, QueryBoolean, Trim } from './email.js';
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

  /** The dashboard's list only: in the shop (true) or hidden (false); the shop shows active ones. */
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  active?: boolean;

  /** The dashboard's list only: with a 3D model, or without one. */
  @IsOptional()
  @IsIn(['with', 'without'])
  model?: 'with' | 'without';
}

export class OrderListQuery extends CursorPageQuery {
  @IsOptional()
  @IsIn(ORDER_SORTS)
  sort: (typeof ORDER_SORTS)[number] = 'createdAt';

  @IsOptional()
  @IsIn(Object.values(OrderStatus))
  status?: OrderStatus;

  /** Several statuses, comma-separated (a dashboard tab, the production planner). */
  @IsOptional()
  @CommaList()
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(Object.values(OrderStatus), { each: true })
  statuses?: OrderStatus[];

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

  /** Order number, machine or colour. */
  @apply(...SEARCH())
  q?: string;
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

  /** One record's entries (with its type): an id, a code or a setting's name. */
  @IsOptional()
  @Matches(/^[A-Za-z0-9_.:-]{1,100}$/)
  targetId?: string;

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
