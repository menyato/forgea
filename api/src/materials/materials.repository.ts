import { Injectable } from '@nestjs/common';
import type { SaveMaterialDto } from '@forgea/validation';
import { PrismaService } from '../database/prisma.service.js';
import type { Material } from '../generated/prisma/client.js';

@Injectable()
export class MaterialsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<Material[]> {
    return this.prisma.material.findMany({ orderBy: { code: 'asc' } });
  }

  create(dto: SaveMaterialDto): Promise<Material> {
    return this.prisma.material.create({ data: dto });
  }

  update(id: string, dto: SaveMaterialDto): Promise<Material> {
    return this.prisma.material.update({ where: { id }, data: dto });
  }
}
