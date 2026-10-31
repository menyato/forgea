import { Injectable } from '@nestjs/common';
import type { SaveMaterialDto } from '@forgea/validation';
import { PrismaService } from '../database/prisma.service.js';
import type { Material } from '../generated/prisma/client.js';
import { StockMovementKind } from '../generated/prisma/enums.js';
import { StockRepository } from '../stock/stock.repository.js';

@Injectable()
export class MaterialsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockRepository,
  ) {}

  list(): Promise<Material[]> {
    return this.prisma.material.findMany({ orderBy: { code: 'asc' } });
  }

  /** A new material; the stock it starts with is its first stock movement. */
  create({ stockGrams, ...dto }: SaveMaterialDto): Promise<Material> {
    return this.prisma.$transaction(async (tx) => {
      const { id } = await tx.material.create({
        data: { ...dto, stockGrams: 0 },
      });
      if (stockGrams > 0) {
        await this.stock.record(tx, [
          {
            materialId: id,
            colour: '',
            kind: StockMovementKind.OPENING,
            grams: stockGrams,
            note: 'Stock when the material was added',
          },
        ]);
      }
      return tx.material.findUniqueOrThrow({ where: { id } });
    });
  }

  /** Stock is never typed over: it moves only by stock movements (Dashboard → Stock). */
  update(id: string, dto: SaveMaterialDto): Promise<Material> {
    return this.prisma.material.update({
      where: { id },
      data: {
        code: dto.code,
        name: dto.name,
        pricePerGram: dto.pricePerGram,
        densityGPerCm3: dto.densityGPerCm3,
        gramsPerHour: dto.gramsPerHour,
        lowStockThresholdGrams: dto.lowStockThresholdGrams,
        active: dto.active,
      },
    });
  }
}
