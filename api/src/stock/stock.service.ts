import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  DateRange,
  StockItemView,
  StockMovementView,
  StockOverview,
} from '@forgea/types';
import type {
  RecordStockMovementDto,
  SaveStockItemDto,
} from '@forgea/validation';
import { Prisma } from '../generated/prisma/client.js';
import { StockMovementKind } from '../generated/prisma/enums.js';
import { ProductionEstimator } from './production-estimator.js';
import { restockAdvice } from './restock.js';
import { StockRepository } from './stock.repository.js';

const key = (materialId: string, colour: string) =>
  `${materialId}\u0000${colour}`;

/** Filament on the shelf, what open orders will take, how fast it goes and what to buy. */
@Injectable()
export class StockService {
  constructor(
    private readonly stock: StockRepository,
    private readonly estimator: ProductionEstimator,
  ) {}

  async overview(today: string, usage: DateRange): Promise<StockOverview> {
    const [items, movements, rows] = await Promise.all([
      this.items(today),
      this.stock.movements(100),
      this.stock.usageByProduct(usage),
    ]);
    return {
      items,
      movements: movements.map((m): StockMovementView => ({
        id: m.id,
        createdAt: m.createdAt.toISOString(),
        kind: m.kind,
        grams: m.grams,
        materialCode: m.stockItem.material.code,
        colour: m.stockItem.colour,
        note: m.note,
        orderNumber: m.orderItem?.order.orderNumber ?? null,
        by: m.createdBy ? (m.createdBy.name ?? m.createdBy.email) : null,
      })),
      usage: { range: usage, rows },
    };
  }

  /**
   * Every stock line with its advice. A line exists once filament came in or went out for that
   * material and colour (a delivery, or the first order of it going into production).
   */
  async items(today: string): Promise<StockItemView[]> {
    const [rows, open] = await Promise.all([
      this.stock.rows(today),
      this.stock.openLines(),
    ]);
    const { estimate } = await this.estimator.for(open);
    const committed = new Map<string, number>();
    for (const line of open) {
      const e = estimate(line);
      if (!e) continue;
      const k = key(e.materialId, e.colour);
      const grams = new Prisma.Decimal(e.gramsPerUnit)
        .times(line.units)
        .ceil()
        .toNumber();
      committed.set(k, (committed.get(k) ?? 0) + grams);
    }
    return rows.map((r): StockItemView => {
      const committedGrams = committed.get(key(r.materialId, r.colour)) ?? 0;
      const advice = restockAdvice({
        stockGrams: r.stock,
        committedGrams,
        used30Grams: r.used30,
        used90Grams: r.used90,
        lowStockGrams: r.lowStockGrams,
        spoolGrams: r.spoolGrams,
        leadTimeDays: r.leadTimeDays,
        coverDays: r.coverDays,
      });
      return {
        id: r.id,
        material: { id: r.materialId, code: r.code, name: r.name },
        colour: r.colour,
        active: r.active,
        stockGrams: r.stock,
        committedGrams,
        availableGrams: advice.availableGrams,
        used30Grams: r.used30,
        used90Grams: r.used90,
        dailyUseGrams: advice.dailyUseGrams.toFixed(1),
        daysLeft: advice.daysLeft,
        reorderPointGrams: advice.reorderPointGrams,
        // A line switched off (a colour no longer sold) is never flagged.
        needsRestock: r.active && advice.needsRestock,
        suggestSpools: r.active ? advice.suggestSpools : 0,
        suggestGrams: r.active ? advice.suggestGrams : 0,
        lowStockGrams: r.lowStockGrams,
        spoolGrams: r.spoolGrams,
        leadTimeDays: r.leadTimeDays,
        coverDays: r.coverDays,
      };
    });
  }

  /** A delivery, other use, or a count correction, by the team. */
  async record(dto: RecordStockMovementDto, actorId: string): Promise<void> {
    if (!(await this.stock.materialExists(dto.materialId))) {
      throw new NotFoundException('Material not found');
    }
    const kind = StockMovementKind[dto.kind];
    const grams = kind === StockMovementKind.USED ? -dto.grams : dto.grams;
    if (kind !== StockMovementKind.CORRECTION && grams === 0) {
      throw new BadRequestException('Enter how many grams');
    }
    await this.stock.transaction((tx) =>
      this.stock.record(tx, [
        {
          materialId: dto.materialId,
          colour: dto.colour,
          kind,
          grams,
          note: dto.note || null,
          createdById: actorId,
        },
      ]),
    );
  }

  async saveItem(id: string, dto: SaveStockItemDto): Promise<void> {
    if (!(await this.stock.findItem(id)))
      throw new NotFoundException('Stock line not found');
    await this.stock.updateItem(id, dto);
  }
}
