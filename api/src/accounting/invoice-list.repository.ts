import { Injectable } from '@nestjs/common';
import type { InvoiceCounts } from '@forgea/types';
import type { InvoiceListQuery } from '@forgea/validation';
import {
  decodeCursor,
  encodeCursor,
  type SortKind,
} from '../common/pagination/keyset.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';

/**
 * Every invoice and credit note with its total and what is still open on it, worked out by the
 * database: the receivable lines' amount less what payments and credit notes matched to them.
 * The same sums as `toInvoiceItem`, so the list can filter and sort by what is owed.
 */
const OPEN = Prisma.sql`
  SELECT e.id, coalesce(e.number, '') AS number, e.date, e.type::text AS type,
         e."customerId", e."orderId",
         coalesce(sum(CASE WHEN e.type = 'INVOICE' THEN l.debit ELSE l.credit END), 0) AS total,
         coalesce(sum(CASE WHEN e.type = 'INVOICE' THEN l.debit ELSE l.credit END), 0)
           - coalesce(sum(m.amount), 0) AS residual
  FROM journal_entries e
  LEFT JOIN journal_lines l ON l."entryId" = e.id
    AND l."accountId" IN (SELECT id FROM accounts WHERE type = 'RECEIVABLE')
  LEFT JOIN LATERAL (
    SELECT sum(r.amount) AS amount FROM reconciliations r
    WHERE (e.type = 'INVOICE' AND r."debitLineId" = l.id)
       OR (e.type <> 'INVOICE' AND r."creditLineId" = l.id)
  ) m ON true
  WHERE e.type IN ('INVOICE', 'CREDIT_NOTE')
  GROUP BY e.id`;

/** The list's filters; several add up (OR). */
const FILTERS = {
  unpaid: Prisma.sql`(i.type = 'INVOICE' AND i.residual > 0)`,
  paid: Prisma.sql`(i.type = 'INVOICE' AND i.residual <= 0)`,
  credit: Prisma.sql`i.type = 'CREDIT_NOTE'`,
} as const;

/** Each sort: its column and how its cursor value is read and compared. */
const SORTS = {
  date: { kind: 'date', column: Prisma.raw('i.date'), cast: 'date' },
  number: { kind: 'string', column: Prisma.raw('i.number'), cast: 'text' },
  total: { kind: 'decimal', column: Prisma.raw('i.total'), cast: 'numeric' },
  residual: {
    kind: 'decimal',
    column: Prisma.raw('i.residual'),
    cast: 'numeric',
  },
} as const satisfies Record<
  InvoiceListQuery['sort'],
  { kind: SortKind; column: Prisma.Sql; cast: string }
>;

interface Listed {
  id: string;
  date: Date;
  number: string;
  total: Prisma.Decimal;
  residual: Prisma.Decimal;
}

/** Postgres LIKE treats % and _ as wildcards: a search for them means the characters. */
const like = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

/** The invoice list (Accounting → Invoices), searched, filtered, sorted and paged in SQL. */
@Injectable()
export class InvoiceListRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** One page of ids in list order, and the cursor for the next. */
  async page(
    query: InvoiceListQuery,
  ): Promise<{ ids: string[]; nextCursor: string | null; hasMore: boolean }> {
    const sort = SORTS[query.sort];
    const desc = query.order === 'desc';
    const where: Prisma.Sql[] = [];
    if (query.filters?.length)
      where.push(
        Prisma.sql`(${Prisma.join(
          query.filters.map((f) => FILTERS[f]),
          ' OR ',
        )})`,
      );
    if (query.q) {
      const p = like(query.q);
      where.push(Prisma.sql`(i.number ILIKE ${p}
        OR EXISTS (SELECT 1 FROM orders o WHERE o.id = i."orderId" AND o."orderNumber" ILIKE ${p})
        OR EXISTS (SELECT 1 FROM users u WHERE u.id = i."customerId"
                   AND (u.email ILIKE ${p} OR u.name ILIKE ${p})))`);
    }
    if (query.cursor) {
      const { value, id } = decodeCursor(
        query.cursor,
        query.sort,
        query.order,
        sort.kind,
      );
      const v = Prisma.sql`CAST(${value} AS ${Prisma.raw(sort.cast)})`;
      where.push(
        desc
          ? Prisma.sql`(${sort.column}, i.id) < (${v}, CAST(${id} AS uuid))`
          : Prisma.sql`(${sort.column}, i.id) > (${v}, CAST(${id} AS uuid))`,
      );
    }
    const dir = Prisma.raw(desc ? 'DESC' : 'ASC');
    const rows = await this.prisma.$queryRaw<Listed[]>`
      SELECT i.id, i.date, i.number, i.total, i.residual
      FROM (${OPEN}) i
      ${where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty}
      ORDER BY ${sort.column} ${dir}, i.id ${dir}
      LIMIT ${query.limit + 1}`;
    const hasMore = rows.length > query.limit;
    const shown = rows.slice(0, query.limit);
    const last = shown.at(-1);
    return {
      ids: shown.map((r) => r.id),
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({
              s: query.sort,
              o: query.order,
              v:
                query.sort === 'date'
                  ? last.date.toISOString()
                  : last[query.sort].toString(),
              id: last.id,
            })
          : null,
    };
  }

  /** The filters' counts over every invoice, and what customers owe in all. */
  async counts(): Promise<InvoiceCounts> {
    const [row] = await this.prisma.$queryRaw<
      { unpaid: number; paid: number; credit: number; owed: Prisma.Decimal }[]
    >`
      SELECT count(*) FILTER (WHERE ${FILTERS.unpaid})::int AS unpaid,
             count(*) FILTER (WHERE ${FILTERS.paid})::int AS paid,
             count(*) FILTER (WHERE ${FILTERS.credit})::int AS credit,
             coalesce(sum(i.residual) FILTER (WHERE i.type = 'INVOICE'), 0) AS owed
      FROM (${OPEN}) i`;
    return {
      unpaid: row?.unpaid ?? 0,
      paid: row?.paid ?? 0,
      credit: row?.credit ?? 0,
      owed: new Prisma.Decimal(row?.owed ?? 0).toFixed(2),
    };
  }
}
