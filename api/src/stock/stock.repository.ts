import { Injectable } from '@nestjs/common';
import type { DateRange } from '@forgea/types';
import type { StockMovementListQuery } from '@forgea/validation';
import { keysetPage } from '../common/pagination/keyset.js';
import { studioDayPlus, studioDayStart } from '../common/studio-day.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { StockMovementKind } from '../generated/prisma/enums.js';

const movementInclude = {
  stockItem: {
    select: {
      colour: true,
      material: { select: { code: true, pricePerGram: true } },
    },
  },
  orderItem: {
    select: {
      order: { select: { id: true, orderNumber: true } },
      // Picked reels: such a line's takes move on its order page, not one by one.
      _count: { select: { filaments: true } },
    },
  },
  product: { select: { name: true } },
  journalEntry: { select: { number: true } },
  createdBy: { select: { email: true, name: true } },
  movedFrom: {
    select: { colour: true, material: { select: { code: true } } },
  },
  movedBy: { select: { email: true, name: true } },
} as const satisfies Prisma.StockMovementInclude;
export type MovementRow = Prisma.StockMovementGetPayload<{
  include: typeof movementInclude;
}>;

/** A movement list's filters (all but the page and the sort). */
function movementWhere(
  query: Pick<StockMovementListQuery, 'stockItemId' | 'kinds' | 'q'>,
): Prisma.StockMovementWhereInput {
  const has = { contains: query.q ?? '', mode: 'insensitive' } as const;
  return {
    ...(query.stockItemId ? { stockItemId: query.stockItemId } : {}),
    ...(query.kinds?.length ? { kind: { in: query.kinds } } : {}),
    ...(query.q
      ? {
          OR: [
            { note: has },
            { stockItem: { colour: has } },
            { stockItem: { material: { code: has } } },
            { orderItem: { order: { orderNumber: has } } },
            { product: { name: has } },
            { createdBy: { OR: [{ email: has }, { name: has }] } },
          ],
        }
      : {}),
  };
}

export interface NewMovement {
  materialId: string;
  colour: string;
  kind: StockMovementKind;
  /** Signed: + in, − out. */
  grams: number;
  orderItemId?: string | null;
  printJobId?: string | null;
  /** USD: a delivery's price paid; filament used, at cost (with machine time). */
  cost?: Prisma.Decimal | string | null;
  costPerGram?: Prisma.Decimal | string | null;
  productId?: string | null;
  quantity?: number | null;
  journalEntryId?: string | null;
  note?: string | null;
  /** The print it went into (the "Where it is" board). */
  pieceId?: string | null;
  createdById?: string | null;
}

/** A movement on a reel the team picked (`recordOnReels`). */
export interface ReelMovement {
  stockItemId: string;
  kind: StockMovementKind;
  /** Signed: + in, − out. */
  grams: number;
  orderItemId?: string | null;
  printJobId?: string | null;
  costPerGram?: Prisma.Decimal | string | null;
  note?: string | null;
  createdById?: string | null;
}

export interface StockRow {
  id: string;
  materialId: string;
  code: string;
  name: string;
  colour: string;
  hex: string | null;
  /** The filament's own cost per gram; null = its material's. */
  ownPricePerGram: string | null;
  active: boolean;
  lowStockGrams: number;
  spoolGrams: number;
  leadTimeDays: number;
  coverDays: number;
  pricePerGram: string;
  stock: number;
  used30: number;
  used90: number;
  lastMovedAt: Date | null;
}

/** Order lines not yet in production, grouped by product and options (what they'll take). */
export interface OpenLine {
  productId: string;
  options: unknown;
  /** A personalised piece's design as ordered. */
  design: unknown;
  units: number;
}

const DAY_MS = 86_400_000;
/**
 * A period's days as timestamps: from its first midnight to the one after its last day, by
 * the studio's days (Beirut), the days invoices and payments are dated by.
 */
export const between = (range: DateRange) => ({
  start: studioDayStart(range.from),
  end: studioDayStart(studioDayPlus(range.to, 1)),
});

/** Filament stock lines and their movements; sums and groupings are done by the database. */
@Injectable()
export class StockRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The stock line of this material and colour, if the shelf has one (never adds it). */
  async existingItem(
    db: Prisma.TransactionClient | PrismaService,
    materialId: string,
    colour: string,
  ): Promise<string | null> {
    const found = await db.stockItem.findUnique({
      where: { materialId_colour: { materialId, colour } },
      select: { id: true },
    });
    return found?.id ?? null;
  }

  /**
   * The filaments (material and colour) the shelf has no line for, named as the stock page
   * does ("PLA · Pink"): what a print may not take from, since nothing adds a filament but
   * the team.
   */
  async notOnShelf(
    wanted: readonly { materialId: string; colour: string }[],
  ): Promise<string[]> {
    const missing: string[] = [];
    for (const w of wanted) {
      if (await this.existingItem(this.prisma, w.materialId, w.colour))
        continue;
      const material = await this.prisma.material.findUnique({
        where: { id: w.materialId },
        select: { code: true },
      });
      const name = `${material?.code ?? 'Filament'} · ${w.colour || 'no colour'}`;
      if (!missing.includes(name)) missing.push(name);
    }
    return missing;
  }

  /** The stock line for a material and colour, added on first use (the team's own entries). */
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
        cost: m.cost ?? null,
        costPerGram: m.costPerGram ?? null,
        productId: m.productId ?? null,
        quantity: m.quantity ?? null,
        journalEntryId: m.journalEntryId ?? null,
        note: m.note ?? null,
        pieceId: m.pieceId ?? null,
        createdById: m.createdById ?? null,
      });
    }
    if (data.length)
      await tx.stockMovement.createMany({ data, skipDuplicates: true });
  }

  /** Movements on reels already known (picked by the team), not found by material and colour. */
  async recordOnReels(
    tx: Prisma.TransactionClient,
    movements: readonly ReelMovement[],
  ): Promise<void> {
    if (movements.length === 0) return;
    await tx.stockMovement.createMany({
      data: movements.map((m) => ({
        stockItemId: m.stockItemId,
        kind: m.kind,
        grams: m.grams,
        orderItemId: m.orderItemId ?? null,
        printJobId: m.printJobId ?? null,
        costPerGram: m.costPerGram ?? null,
        note: m.note ?? null,
        createdById: m.createdById ?? null,
      })),
      // An order line already taken from a reel is not taken again (running twice is safe).
      skipDuplicates: true,
    });
  }

  /** Every stock line with what is on the shelf and what went out in the last 30 and 90 days. */
  rows(today: string): Promise<StockRow[]> {
    const end = Date.parse(`${today}T00:00:00Z`) + DAY_MS;
    const since30 = new Date(end - 30 * DAY_MS);
    const since90 = new Date(end - 90 * DAY_MS);
    return this.prisma.$queryRaw<StockRow[]>`
      SELECT i.id, i."materialId", m.code, m.name, i.colour, i.hex, i.active,
             i."pricePerGram"::text AS "ownPricePerGram",
             i."lowStockGrams", i."spoolGrams", i."leadTimeDays", i."coverDays",
             m."pricePerGram"::text AS "pricePerGram",
             coalesce(sum(s.grams), 0)::int AS stock,
             coalesce(-sum(s.grams) FILTER (
               WHERE s.kind IN ('ORDER', 'FAILED_PRINT', 'USED', 'RETURNED') AND s."createdAt" >= ${since30}
             ), 0)::int AS used30,
             coalesce(-sum(s.grams) FILTER (
               WHERE s.kind IN ('ORDER', 'FAILED_PRINT', 'USED', 'RETURNED') AND s."createdAt" >= ${since90}
             ), 0)::int AS used90,
             max(s."createdAt") AS "lastMovedAt"
      FROM stock_items i
      JOIN materials m ON m.id = i."materialId"
      LEFT JOIN stock_movements s ON s."stockItemId" = i.id
      GROUP BY i.id, m.code, m.name, m."pricePerGram"
      ORDER BY m.code, i.colour
    `;
  }

  /** Lines of orders placed but not in production yet: they will take filament soon. */
  openLines(): Promise<OpenLine[]> {
    return this.prisma.$queryRaw<OpenLine[]>`
      SELECT i."productId", i.options, i.design, sum(i.quantity)::int AS units
      FROM order_items i
      JOIN orders o ON o.id = i."orderId"
      WHERE o.status IN ('PENDING', 'AWAITING_DEPOSIT', 'CONFIRMED')
        AND i."productId" IS NOT NULL
      GROUP BY i."productId", i.options, i.design
    `;
  }

  /** One page of movements, newest first by default (or by grams). */
  movements(query: StockMovementListQuery) {
    const where = movementWhere(query);
    return keysetPage<MovementRow>(
      {
        sortField: query.sort,
        kind: query.sort === 'grams' ? 'int' : 'date',
        order: query.order,
        limit: query.limit,
        cursor: query.cursor,
        valueOf: (m) => (query.sort === 'grams' ? m.grams : m.createdAt),
      },
      ({ after, orderBy, take }) =>
        this.prisma.stockMovement.findMany({
          where: { AND: [where, after as Prisma.StockMovementWhereInput] },
          orderBy: orderBy as Prisma.StockMovementOrderByWithRelationInput[],
          take,
          include: movementInclude,
        }),
    );
  }

  /** How many movements of each kind (one line's, or all), for the list's filters. */
  async movementCounts(stockItemId?: string) {
    const rows = await this.prisma.stockMovement.groupBy({
      by: ['kind'],
      where: movementWhere({ stockItemId }),
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.kind, r._count._all]));
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

  /**
   * Filament in and out over the period with its cost. A movement's own cost when it has one;
   * orders' filament otherwise at its cost per gram when it went out, or today's.
   */
  async costs(range: DateRange) {
    const { start, end } = between(range);
    const rows = await this.prisma.$queryRaw<
      { kind: string; grams: number; cost: Prisma.Decimal }[]
    >`
      -- A finished print's difference counts with its order's filament (what it really used):
      -- more taken adds to it, any given back takes from it.
      SELECT CASE WHEN s.kind IN ('PRINTED', 'RETURNED') THEN 'ORDER' ELSE s.kind::text END AS kind,
             abs(sum(s.grams))::int AS grams,
             coalesce(sum(coalesce(s.cost, abs(s.grams) * coalesce(s."costPerGram", m."pricePerGram"))
               * CASE WHEN s.kind IN ('PRINTED', 'RETURNED') AND s.grams > 0 THEN -1 ELSE 1 END), 0)
               ::decimal(12, 2) AS cost
      FROM stock_movements s
      JOIN stock_items i ON i.id = s."stockItemId"
      JOIN materials m ON m.id = i."materialId"
      WHERE s.kind IN ('RECEIVED', 'ORDER', 'USED', 'FAILED_PRINT', 'PRINTED', 'RETURNED')
        AND s."createdAt" >= ${start} AND s."createdAt" < ${end}
      GROUP BY 1
    `;
    return new Map(rows.map((r) => [r.kind, r]));
  }

  /** The shop's colour swatches by label (the first one found for each). */
  async swatches(): Promise<Map<string, string>> {
    const rows = await this.prisma.optionValue.findMany({
      where: { swatchHex: { not: null } },
      select: { label: true, swatchHex: true },
      orderBy: { id: 'asc' },
    });
    const out = new Map<string, string>();
    for (const r of rows) if (!out.has(r.label)) out.set(r.label, r.swatchHex!);
    return out;
  }

  /**
   * What is on the shelf for a material and colour, read under the material's stock lock (the
   * one each movement takes), so a count's difference is exact.
   */
  /** One movement, as the lists show it. */
  movement(id: string): Promise<MovementRow | null> {
    return this.prisma.stockMovement.findUnique({
      where: { id },
      include: movementInclude,
    });
  }

  /**
   * A take or delivery recorded on the wrong filament, put on the one it really was (inside a
   * transaction the database lets make only this change): its grams leave the first filament and
   * count on the new one, at the new one's cost per gram; what it was for stays as recorded.
   */
  async moveTo(
    id: string,
    reel: { id: string; pricePerGram: Prisma.Decimal },
    actorId: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('forgea.repointing', 'wrong-reel', true)`;
      const current = await tx.stockMovement.findUnique({
        where: { id },
        select: { stockItemId: true },
      });
      if (!current || current.stockItemId === reel.id) return false;
      await tx.stockMovement.update({
        where: { id },
        data: {
          stockItemId: reel.id,
          costPerGram: reel.pricePerGram,
          movedFromId: current.stockItemId,
          movedAt: new Date(),
          movedById: actorId,
        },
      });
      return true;
    });
  }

  /** A filament line and the cost per gram a take from it is valued at (its own, else its material's). */
  async reel(id: string): Promise<{
    id: string;
    materialId: string;
    colour: string;
    pricePerGram: Prisma.Decimal;
  } | null> {
    const r = await this.prisma.stockItem.findUnique({
      where: { id },
      select: {
        id: true,
        materialId: true,
        colour: true,
        pricePerGram: true,
        material: { select: { pricePerGram: true } },
      },
    });
    return r
      ? {
          id: r.id,
          materialId: r.materialId,
          colour: r.colour,
          pricePerGram: r.pricePerGram ?? r.material.pricePerGram,
        }
      : null;
  }

  /** Whether an order line already took from this filament (one take per line and reel). */
  async lineTookFrom(
    orderItemId: string,
    stockItemId: string,
  ): Promise<boolean> {
    return (
      (await this.prisma.stockMovement.count({
        where: { orderItemId, stockItemId, kind: StockMovementKind.ORDER },
      })) > 0
    );
  }

  async onShelf(
    tx: Prisma.TransactionClient,
    materialId: string,
    colour: string,
  ): Promise<number> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('stock:' || ${materialId}::text))`;
    const [row] = await tx.$queryRaw<{ grams: number }[]>`
      SELECT coalesce(sum(s.grams), 0)::int AS grams
      FROM stock_movements s
      JOIN stock_items i ON i.id = s."stockItemId"
      WHERE i."materialId" = ${materialId}::uuid AND i.colour = ${colour}
    `;
    return row?.grams ?? 0;
  }

  material(id: string) {
    return this.prisma.material.findUnique({
      where: { id },
      select: { id: true, code: true, name: true, pricePerGram: true },
    });
  }

  /** A delivery's price becomes the material's reel (and so its cost per gram). */
  setReel(
    tx: Prisma.TransactionClient,
    id: string,
    reel: { price: string; grams: number; pricePerGram: string },
  ) {
    return tx.material.update({
      where: { id },
      data: {
        reelPrice: reel.price,
        reelGrams: reel.grams,
        pricePerGram: reel.pricePerGram,
      },
    });
  }

  /** Products the studio may print for itself (or one of them), with their sizes and colours. */
  printables(id?: string) {
    return this.prisma.product.findMany({
      ...(id ? { where: { id } } : {}),
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        material: { select: { code: true } },
        modelFileKey: true,
        sizes: {
          select: { sizeXcm: true, sizeYcm: true, sizeZcm: true },
          orderBy: { sortOrder: 'asc' },
        },
        optionValues: {
          where: { value: { swatchHex: { not: null }, active: true } },
          select: {
            value: {
              select: {
                label: true,
                swatchHex: true,
                group: { select: { name: true } },
              },
            },
          },
        },
        textColourGroup: {
          select: {
            name: true,
            values: {
              where: { active: true, swatchHex: { not: null } },
              select: { label: true, swatchHex: true },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
        // Parts customers recolour: the piece is printed in one of the group's colours.
        // Every colour (the parts customers recolour among them).
        colours: {
          select: {
            part: true,
            colour: true,
            hex: true,
            stockItemId: true,
            startsAs: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
        partColourGroup: {
          select: {
            name: true,
            values: {
              where: { active: true },
              select: { label: true, swatchHex: true, stockItemId: true },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    });
  }

  findItem(id: string) {
    return this.prisma.stockItem.findUnique({ where: { id } });
  }

  /** What a gram of this filament costs, from the spools just received. */
  async setFilamentPrice(
    tx: Prisma.TransactionClient,
    materialId: string,
    colour: string,
    pricePerGram: string,
  ): Promise<void> {
    await tx.stockItem.updateMany({
      where: { materialId, colour },
      data: { pricePerGram },
    });
  }

  /** How a material's colour looks (picked when its spools come in or are weighed). */
  async setColourHex(
    tx: Prisma.TransactionClient,
    materialId: string,
    colour: string,
    hex: string,
  ): Promise<void> {
    await tx.stockItem.updateMany({
      where: { materialId, colour },
      data: { hex },
    });
  }

  createItem(data: Prisma.StockItemUncheckedCreateInput) {
    return this.prisma.stockItem.create({ data, select: { id: true } });
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
