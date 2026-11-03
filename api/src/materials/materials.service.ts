import { BadRequestException, Injectable } from '@nestjs/common';
import { pricePerGramFromReel } from '@forgea/pricing';
import type { MaterialView } from '@forgea/types';
import type { SaveMaterialDto } from '@forgea/validation';
import type { Material } from '../generated/prisma/client.js';
import {
  type MaterialInput,
  MaterialsRepository,
} from './materials.repository.js';

/** Filament and resin: what they cost, how dense they are, how fast they print, what's in stock. */
@Injectable()
export class MaterialsService {
  constructor(private readonly materials: MaterialsRepository) {}

  async list(): Promise<MaterialView[]> {
    return (await this.materials.list()).map(toView);
  }

  async create(dto: SaveMaterialDto): Promise<MaterialView> {
    return toView(await this.materials.create(withCost(dto)));
  }

  async update(id: string, dto: SaveMaterialDto): Promise<MaterialView> {
    return toView(await this.materials.update(id, withCost(dto)));
  }
}

/**
 * What a gram costs: from the reel as bought when it is given (its price ÷ its weight), or as
 * typed (a catalog file may carry only that).
 */
function withCost(dto: SaveMaterialDto): MaterialInput {
  const fields = {
    code: dto.code,
    name: dto.name,
    densityGPerCm3: dto.densityGPerCm3,
    gramsPerHour: dto.gramsPerHour,
    stockGrams: dto.stockGrams,
    lowStockThresholdGrams: dto.lowStockThresholdGrams,
    active: dto.active,
  };
  if (dto.reelPrice !== undefined && dto.reelGrams !== undefined) {
    return {
      ...fields,
      pricePerGram: pricePerGramFromReel(dto.reelPrice, dto.reelGrams),
      reelPrice: dto.reelPrice,
      reelGrams: dto.reelGrams,
    };
  }
  if (dto.pricePerGram === undefined) {
    throw new BadRequestException("Enter the reel's price and weight");
  }
  return {
    ...fields,
    pricePerGram: dto.pricePerGram,
    reelPrice: null,
    reelGrams: null,
  };
}

function toView(m: Material): MaterialView {
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    pricePerGram: m.pricePerGram.toString(),
    reelPrice: m.reelPrice?.toString() ?? null,
    reelGrams: m.reelGrams,
    densityGPerCm3: m.densityGPerCm3.toString(),
    gramsPerHour: m.gramsPerHour.toString(),
    stockGrams: m.stockGrams,
    lowStockThresholdGrams: m.lowStockThresholdGrams,
    active: m.active,
  };
}
