import { BadRequestException } from '@nestjs/common';
import type { Page } from '@forgea/types';
import type { SortOrder } from '@forgea/validation';

/** How a sort field's value is written into the cursor and read back. */
export type SortKind = 'date' | 'string' | 'decimal';

interface CursorPayload {
  /** Sort field and order the cursor belongs to; a cursor is only valid for the same sort. */
  s: string;
  o: SortOrder;
  /** Sort value of the last row on the page, and its id as the tie-breaker. */
  v: string;
  id: string;
}

export interface KeysetRequest<Row extends { id: string }> {
  sortField: string;
  kind: SortKind;
  order: SortOrder;
  limit: number;
  cursor?: string | undefined;
  /** The sort field's value on a row (Date, string, or a Prisma Decimal). */
  valueOf: (row: Row) => Date | string | { toString(): string };
}

export interface KeysetQuery {
  /** Rows strictly after the cursor; `{}` on the first page. AND it with the list's filters. */
  after: Record<string, unknown>;
  orderBy: Record<string, SortOrder>[];
  /** One more than the page size, to learn whether another page exists. */
  take: number;
}

/**
 * Keyset ("seek") pagination: each page asks for rows after the last one seen, ordered by
 * (sort field, id). Unlike OFFSET it stays fast on large tables, and rows inserted while a
 * user pages through never cause duplicates or gaps. Ties on the sort field are broken by
 * the id, so every row has a unique position.
 */
export async function keysetPage<Row extends { id: string }>(
  request: KeysetRequest<Row>,
  fetch: (query: KeysetQuery) => Promise<Row[]>,
): Promise<{ rows: Row[]; nextCursor: string | null; hasMore: boolean }> {
  const { order, limit } = request;
  // Ids are UUIDv7, made by the database at insert: their order is creation order and they
  // are indexed everywhere, so "newest first" reads one page instead of sorting the table.
  const sortField =
    request.sortField === 'createdAt' ? 'id' : request.sortField;
  const op = order === 'asc' ? 'gt' : 'lt';
  let after: Record<string, unknown> = {};

  if (request.cursor) {
    const { value, id } = decodeCursor(
      request.cursor,
      sortField,
      order,
      request.kind,
    );
    after =
      sortField === 'id'
        ? { id: { [op]: id } }
        : {
            OR: [
              { [sortField]: { [op]: value } },
              { [sortField]: value, id: { [op]: id } },
            ],
          };
  }

  const orderBy =
    sortField === 'id'
      ? [{ id: order }]
      : [{ [sortField]: order }, { id: order }];
  const fetched = await fetch({ after, orderBy, take: limit + 1 });
  const hasMore = fetched.length > limit;
  const rows = hasMore ? fetched.slice(0, limit) : fetched;
  const last = rows.at(-1);

  return {
    rows,
    hasMore,
    nextCursor:
      hasMore && last
        ? encodeCursor({
            s: sortField,
            o: order,
            v: serialize(request.valueOf(last)),
            id: last.id,
          })
        : null,
  };
}

/** Maps rows to API items, keeping the paging fields. */
export function toPage<Row, Item>(
  page: { rows: Row[]; nextCursor: string | null; hasMore: boolean },
  map: (row: Row) => Item,
): Page<Item> {
  return {
    items: page.rows.map(map),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

function serialize(value: Date | string | { toString(): string }): string {
  return value instanceof Date ? value.toISOString() : value.toString();
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

const INVALID = 'This page link is no longer valid. Start from the first page.';

export function decodeCursor(
  cursor: string,
  sortField: string,
  order: SortOrder,
  kind: SortKind,
): { value: Date | string; id: string } {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException(INVALID);
  }
  if (
    typeof payload !== 'object' ||
    payload === null ||
    (payload as CursorPayload).s !== sortField ||
    (payload as CursorPayload).o !== order ||
    typeof (payload as CursorPayload).v !== 'string' ||
    typeof (payload as CursorPayload).id !== 'string' ||
    !/^[0-9a-f-]{36}$/.test((payload as CursorPayload).id)
  ) {
    throw new BadRequestException(INVALID);
  }
  const { v, id } = payload as CursorPayload;
  switch (kind) {
    case 'date': {
      const date = new Date(v);
      if (Number.isNaN(date.getTime())) throw new BadRequestException(INVALID);
      return { value: date, id };
    }
    case 'decimal':
      if (!/^-?\d+(\.\d+)?$/.test(v)) throw new BadRequestException(INVALID);
      return { value: v, id };
    case 'string':
      return { value: v, id };
  }
}
