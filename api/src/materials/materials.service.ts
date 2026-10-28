import { Injectable } from '@nestjs/common';
import type { MaterialView } from '@forgea/types';
import type { SaveMaterialDto } from '@forgea/validation';
import type { Material } from '../generated/prisma/client.js';
import { MaterialsRepository } from './materials.repository.js';

/** Filament and resin: what they cost, how dense they are, how fast they print, what's in stock. */
@Injectable()
export class MaterialsService {
  constructor(private readonly materials: MaterialsRepository) {}

  async list(): Promise<MaterialView[]> {
    return (await this.materials.list()).map(toView);
  }

  async create(dto: SaveMaterialDto): Promise<MaterialView> {
    return toView(await this.materials.create(dto));
  }

  async update(id: string, dto: SaveMaterialDto): Promise<MaterialView> {
    return toView(await this.materials.update(id, dto));
  }
}

function toView(m: Material): MaterialView {
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    pricePerGram: m.pricePerGram.toString(),
    densityGPerCm3: m.densityGPerCm3.toString(),
    gramsPerHour: m.gramsPerHour.toString(),
    stockGrams: m.stockGrams,
    lowStockThresholdGrams: m.lowStockThresholdGrams,
    active: m.active,
  };
}
