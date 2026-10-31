import { Injectable } from '@nestjs/common';
import type { DateRange } from '@forgea/types';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { StockMovementKind } from '../generated/prisma/enums.js';

export interface NewMovement {
  materialId: string;
  colour: string;
  kind: StockMovementKind;
  /** Signed: + in, − out. */
  grams: number;
  orderItemId?: string | null;
  printJobId?: string | null;
  note?: string | null;
  createdById?: string | null;
}

export interface StockRow {
  id: string;
  materialId: string;
  code: string;
  name: string;
  colour: string;
  active: boolean;
  lowStockGrams: number;
  spoolGrams: number;
  leadTimeDays: number;
  coverDays: number;
  stock: number;
  used30: number;
  used90: number;
}

/** Order lines not yet in production, grouped by product and options (what they'll take). */
export interface OpenLine {
  productId: string;
  options: unknown;
  units: number;
}

const DAY_MS = 86_400_000;
/** A period's days as timestamps: from its first midnight (UTC) to the one after its last day. */
export const between = (range: DateRange) => ({
  start: new Date(`${range.from}T00:00:00Z`),
  end: new Date(Date.parse(`${range.to}T00:00:00Z`) + DAY_MS),
});

/** Filament stock lines and their movements; sums and groupings are done by the database. */
@Injectable()
export class StockRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The stock line for a material and colour, created on first use with the material's limit. */
  async itemFor(
    tx: Prisma.TransactionClient,
    materialId: string,
    colour: string,
  ): Promise<string> {
    const found = await tx.stockItem.findUnique({
      where: { materialId_colour: { materialId, colour } },
      select: { id: true },
    });
    if (found) return found.id;
    const material = await tx.material.findUniqueOrThrow({
      where: { id: materialId },
      select: { lowStockThresholdGrams: true },
    });
    const { id } = await tx.stockItem.upsert({
      where: { materialId_colour: { materialId, colour } },
      create: {
        materialId,
        colour,
        lowStockGrams: material.lowStockThresholdGrams,
      },
      update: {},
      select: { id: true },
    });
    return id;
  }

  /**
   * Adds movements (the database trigger keeps the material's total). An order line already
   * taken out of stock is skipped, so running this twice never takes it twice.
   */
  async record(
    tx: Prisma.TransactionClient,
    movements: readonly NewMovement[],
  ): Promise<void> {
    const data: Prisma.StockMovementCreateManyInput[] = [];
    for (const m of movements) {
      data.push({
        stockItemId: await this.itemFor(tx, m.materialId, m.colour),
        kind: m.kind,
        grams: m.grams,
        orderItemId: m.orderItemId ?? null,
        printJobId: m.printJobId ?? null,
        note: m.note ?? null,
        createdById: m.createdById ?? null,
      });
    }
    if (data.length)
      await tx.stockMovement.createMany({ data, skipDuplicates: true });
  }

  /** Every stock line with what is on the shelf and what went out in the last 30 and 90 days. */
  rows(today: string): Promise<StockRow[]> {
    const end = Date.parse(`${today}T00:00:00Z`) + DAY_MS;
    const since30 = new Date(end - 30 * DAY_MS);
    const since90 = new Date(end - 90 * DAY_MS);
    return this.prisma.$queryRaw<StockRow[]>`
      SELECT i.id, i."materialId", m.code, m.name, i.colour, i.active,
             i."lowStockGrams", i."spoolGrams", i."leadTimeDays", i."coverDays",
             coalesce(sum(s.grams), 0)::int AS stock,
             coalesce(-sum(s.grams) FILTER (
               WHERE s.kind IN ('ORDER', 'FAILED_PRINT', 'USED') AND s."createdAt" >= ${since30}
             ), 0)::int AS used30,
             coalesce(-sum(s.grams) FILTER (
               WHERE s.kind IN ('ORDER', 'FAILED_PRINT', 'USED') AND s."createdAt" >= ${since90}
             ), 0)::int AS used90
      FROM stock_items i
      JOIN materials m ON m.id = i."materialId"
      LEFT JOIN stock_movements s ON s."stockItemId" = i.id
      GROUP BY i.id, m.code, m.name
      ORDER BY m.code, i.colour
    `;
  }

  /** Lines of orders placed but not in production yet: they will take filament soon. */
  openLines(): Promise<OpenLine[]> {
    return this.prisma.$queryRaw<OpenLine[]>`
      SELECT i."productId", i.options, sum(i.quantity)::int AS units
      FROM order_items i
      JOIN orders o ON o.id = i."orderId"
      WHERE o.status IN ('PENDING', 'AWAITING_DEPOSIT', 'CONFIRMED')
        AND i."productId" IS NOT NULL
      GROUP BY i."productId", i.options
    `;
  }

  movements(take: number) {
    return this.prisma.stockMovement.findMany({
      orderBy: { id: 'desc' },
      take,
      include: {
        stockItem: {
          select: { colour: true, material: { select: { code: true } } },
        },
        orderItem: { select: { order: { select: { orderNumber: true } } } },
        createdBy: { select: { email: true, name: true } },
      },
    });
  }

  /** Grams each product's orders took out of stock in the period, per material and colour. */
  usageByProduct(range: DateRange) {
    const { start, end } = between(range);
    return this.prisma.$queryRaw<
      {
        productId: string;
        product: string;
        materialCode: string;
        colour: string;
        grams: number;
      }[]
    >`
      SELECT p.id AS "productId", p.name AS product, m.code AS "materialCode", i.colour,
             (-sum(s.grams))::int AS grams
      FROM stock_movements s
      JOIN stock_items i ON i.id = s."stockItemId"
      JOIN materials m ON m.id = i."materialId"
      JOIN order_items oi ON oi.id = s."orderItemId"
      JOIN products p ON p.id = oi."productId"
      WHERE s.kind = 'ORDER' AND s."createdAt" >= ${start} AND s."createdAt" < ${end}
      GROUP BY p.id, p.name, m.code, i.colour
      ORDER BY grams DESC, p.name
      LIMIT 200
    `;
  }

  /** Grams used (orders and other use) and lost to failed prints in the period, per line. */
  usageByItem(range: DateRange) {
    const { start, end } = between(range);
    return this.prisma.$queryRaw<
      { stockItemId: string; used: number; failed: number }[]
    >`
      SELECT s."stockItemId",
             coalesce(-sum(s.grams) FILTER (WHERE s.kind IN ('ORDER', 'USED')), 0)::int AS used,
             coalesce(-sum(s.grams) FILTER (WHERE s.kind = 'FAILED_PRINT'), 0)::int AS failed
      FROM stock_movements s
      WHERE s.kind IN ('ORDER', 'USED', 'FAILED_PRINT')
        AND s."createdAt" >= ${start} AND s."createdAt" < ${end}
      GROUP BY s."stockItemId"
    `;
  }

  findItem(id: string) {
    return this.prisma.stockItem.findUnique({ where: { id } });
  }

  updateItem(id: string, data: Prisma.StockItemUpdateInput) {
    return this.prisma.stockItem.update({ where: { id }, data });
  }

  materialExists(id: string): Promise<boolean> {
    return this.prisma.material.count({ where: { id } }).then((n) => n === 1);
  }

  transaction<T>(
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(run);
  }
}
