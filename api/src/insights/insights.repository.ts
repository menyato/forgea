import { Injectable } from '@nestjs/common';
import type { DateRange, InsightsGranularity } from '@forgea/types';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { OrderStatus } from '../generated/prisma/enums.js';
import { between } from '../stock/stock.repository.js';

/** Invoiced order lines of one chart bar, grouped by product and options (signed: credit notes take off). */
export interface InvoicedLine {
  bucket: string;
  productId: string | null;
  options: unknown;
  /** A personalised piece's design as ordered (its own grams and hours). */
  design: unknown;
  units: number;
  /** Tax included, as the order line says. */
  gross: Prisma.Decimal;
}

export interface OrderSummary {
  placed: number;
  cancelled: number;
  value: Prisma.Decimal;
  delivery: number;
  pickup: number;
  cod: number;
  transfer: number;
  rush: number;
}

/**
 * The business page's numbers, each added up by the database in one query (`$queryRaw` with
 * parameters, never assembled SQL). Book figures go by the entry's date (a UTC day, like the
 * reports); order, request, quotation and lead figures by when they were created, over the
 * same UTC days.
 */
@Injectable()
export class InsightsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lines of the orders whose final invoice is dated in the period, less those whose final
   * invoice was credited in it: exactly what the books' revenue holds for products.
   */
  invoicedLines(
    range: DateRange,
    unit: InsightsGranularity,
  ): Promise<InvoicedLine[]> {
    return this.prisma.$queryRaw<InvoicedLine[]>`
      SELECT to_char(date_trunc(${unit}, e.date::timestamp), 'YYYY-MM-DD') AS bucket,
             i."productId", i.options, i.design,
             sum(CASE WHEN e.type = 'INVOICE' THEN i.quantity ELSE -i.quantity END)::int AS units,
             sum(CASE WHEN e.type = 'INVOICE' THEN i."lineTotal" ELSE -i."lineTotal" END) AS gross
      FROM journal_entries e
      JOIN order_items i ON i."orderId" = e."orderId"
      WHERE e.state = 'POSTED' AND e."invoiceKind" = 'FINAL'
        AND e.type IN ('INVOICE', 'CREDIT_NOTE')
        AND e.date BETWEEN ${range.from}::date AND ${range.to}::date
      GROUP BY 1, i."productId", i.options, i.design
    `;
  }

  /** Income in the books per chart bar (taxes excluded, credit notes taken off). */
  incomeSeries(
    range: DateRange,
    unit: InsightsGranularity,
  ): Promise<{ bucket: string; income: Prisma.Decimal }[]> {
    return this.prisma.$queryRaw`
      SELECT to_char(date_trunc(${unit}, e.date::timestamp), 'YYYY-MM-DD') AS bucket,
             sum(l.credit - l.debit) AS income
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l."entryId" AND e.state = 'POSTED'
      JOIN accounts a ON a.id = l."accountId" AND a.type = 'INCOME'
      WHERE e.date BETWEEN ${range.from}::date AND ${range.to}::date
      GROUP BY 1
    `;
  }

  /**
   * The tax in the period's sales (final invoices carry the order's whole tax; their deposit
   * lines only undo the deposit's), payments received in cash or by transfer, and what
   * customers owed at the end of the period.
   */
  async money(range: DateRange): Promise<{
    tax: Prisma.Decimal;
    collected: Prisma.Decimal;
    owed: Prisma.Decimal;
  }> {
    const [row] = await this.prisma.$queryRaw<
      { tax: Prisma.Decimal; collected: Prisma.Decimal; owed: Prisma.Decimal }[]
    >`
      SELECT
        coalesce(sum(CASE WHEN e.type = 'INVOICE' THEN l.credit ELSE -l.debit END) FILTER (
          WHERE l."taxId" IS NOT NULL AND e."invoiceKind" = 'FINAL'
            AND e.type IN ('INVOICE', 'CREDIT_NOTE') AND e.date >= ${range.from}::date
        ), 0) AS tax,
        coalesce(sum(l.debit - l.credit) FILTER (
          WHERE e.type = 'PAYMENT' AND a.type IN ('CASH', 'BANK')
            AND e.date >= ${range.from}::date
        ), 0) AS collected,
        coalesce(sum(l.debit - l.credit) FILTER (WHERE a.type = 'RECEIVABLE'), 0) AS owed
      FROM journal_lines l
      JOIN journal_entries e
        ON e.id = l."entryId" AND e.state = 'POSTED' AND e.date <= ${range.to}::date
      JOIN accounts a ON a.id = l."accountId"
    `;
    return row!;
  }

  async orders(range: DateRange): Promise<OrderSummary> {
    const { start, end } = between(range);
    const [row] = await this.prisma.$queryRaw<OrderSummary[]>`
      SELECT count(*)::int AS placed,
             count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
             coalesce(sum(total) FILTER (WHERE status <> 'CANCELLED'), 0) AS value,
             count(*) FILTER (WHERE status <> 'CANCELLED' AND delivery)::int AS delivery,
             count(*) FILTER (WHERE status <> 'CANCELLED' AND NOT delivery)::int AS pickup,
             count(*) FILTER (WHERE status <> 'CANCELLED' AND "paymentMethod" = 'COD')::int AS cod,
             count(*) FILTER (WHERE status <> 'CANCELLED' AND "paymentMethod" = 'TRANSFER')::int AS transfer,
             count(*) FILTER (WHERE status <> 'CANCELLED' AND rush)::int AS rush
      FROM orders
      WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
    `;
    return row!;
  }

  async byStatus(
    range: DateRange,
  ): Promise<Partial<Record<OrderStatus, number>>> {
    const { start, end } = between(range);
    const rows = await this.prisma.order.groupBy({
      by: ['status'],
      where: { createdAt: { gte: start, lt: end } },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }

  /** Customers who ordered in the period: first order ever in it (new), or before (returning). */
  async customers(
    range: DateRange,
  ): Promise<{ new: number; returning: number }> {
    const { start, end } = between(range);
    const [row] = await this.prisma.$queryRaw<
      { new: number; returning: number }[]
    >`
      SELECT count(*) FILTER (WHERE f.first >= ${start})::int AS "new",
             count(*) FILTER (WHERE f.first < ${start})::int AS returning
      FROM (
        SELECT DISTINCT "userId" FROM orders
        WHERE "createdAt" >= ${start} AND "createdAt" < ${end} AND status <> 'CANCELLED'
      ) p
      CROSS JOIN LATERAL (
        SELECT min(o."createdAt") AS first FROM orders o WHERE o."userId" = p."userId"
      ) f
    `;
    return row!;
  }

  /**
   * What customers chose on the orders they placed: values of choice groups (colours,
   * finishes…) and the products' sizes (stored by their measurements). Typed texts (names on
   * keychains) are never listed.
   */
  options(
    range: DateRange,
  ): Promise<{ group: string; value: string; units: number }[]> {
    const { start, end } = between(range);
    return this.prisma.$queryRaw`
      WITH chosen AS (
        SELECT o->>'group' AS "group", o->>'value' AS value, i.quantity, i."productId"
        FROM order_items i
        JOIN orders r ON r.id = i."orderId"
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(i.options) = 'array' THEN i.options ELSE '[]'::jsonb END
        ) o
        WHERE r."createdAt" >= ${start} AND r."createdAt" < ${end}
          AND r.status <> 'CANCELLED' AND i."productId" IS NOT NULL
      )
      SELECT c."group", c.value, sum(c.quantity)::int AS units
      FROM chosen c
      WHERE EXISTS (
          SELECT 1 FROM option_groups g WHERE g.name = c."group" AND g.kind = 'CHOICE'
        )
        OR EXISTS (
          SELECT 1 FROM product_sizes s
          WHERE s."productId" = c."productId"
            AND trim_scale(s."sizeXcm")::text || ' × ' || trim_scale(s."sizeYcm")::text
              || ' × ' || trim_scale(s."sizeZcm")::text || ' cm' = c.value
        )
      GROUP BY c."group", c.value
      ORDER BY units DESC, c.value
    `;
  }

  async requests(
    range: DateRange,
  ): Promise<{ submitted: number; quoted: number; accepted: number }> {
    const { start, end } = between(range);
    const [row] = await this.prisma.$queryRaw<
      { submitted: number; quoted: number; accepted: number }[]
    >`
      SELECT count(*)::int AS submitted,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM custom_request_status_history h
               WHERE h."requestId" = r.id AND h.status = 'QUOTED'
             ))::int AS quoted,
             count(*) FILTER (WHERE r.status = 'ACCEPTED')::int AS accepted
      FROM custom_requests r
      WHERE r."createdAt" >= ${start} AND r."createdAt" < ${end}
    `;
    return row!;
  }

  async quotations(
    range: DateRange,
  ): Promise<{ created: number; sent: number; confirmed: number }> {
    const { start, end } = between(range);
    const [row] = await this.prisma.$queryRaw<
      { created: number; sent: number; confirmed: number }[]
    >`
      SELECT count(*)::int AS created,
             count(*) FILTER (WHERE "sentAt" IS NOT NULL)::int AS sent,
             count(*) FILTER (WHERE status = 'CONFIRMED')::int AS confirmed
      FROM quotations
      WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
    `;
    return row!;
  }

  async leads(range: DateRange): Promise<{
    created: number;
    won: number;
    lost: number;
    lostReasons: { name: string; count: number }[];
  }> {
    const { start, end } = between(range);
    const [counts, lostReasons] = await Promise.all([
      this.prisma.$queryRaw<{ created: number; won: number; lost: number }[]>`
        SELECT
          (SELECT count(*)::int FROM leads
           WHERE "createdAt" >= ${start} AND "createdAt" < ${end}) AS created,
          count(*) FILTER (WHERE "lostReasonId" IS NULL)::int AS won,
          count(*) FILTER (WHERE "lostReasonId" IS NOT NULL)::int AS lost
        FROM leads
        WHERE "closedAt" >= ${start} AND "closedAt" < ${end}
      `,
      this.prisma.$queryRaw<{ name: string; count: number }[]>`
        SELECT r.name, count(*)::int AS count
        FROM leads l JOIN lost_reasons r ON r.id = l."lostReasonId"
        WHERE l."closedAt" >= ${start} AND l."closedAt" < ${end}
        GROUP BY r.name
        ORDER BY 2 DESC, r.name
      `,
    ]);
    return { ...counts[0]!, lostReasons };
  }

  /** The sales tax included in shop prices now (null: none). */
  async salesTaxRate(): Promise<Prisma.Decimal | null> {
    const s = await this.prisma.accountingSettings.findUniqueOrThrow({
      where: { id: 1 },
      include: { salesTax: { select: { ratePercent: true } } },
    });
    return s.salesTax?.ratePercent ?? null;
  }
}
