import { Injectable } from '@nestjs/common';
import type {
  SaveOptionGroupDto,
  SaveOptionValueDto,
} from '@forgea/validation';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { OptionKind } from '../generated/prisma/enums.js';

const withValues = {
  values: { orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] },
} as const satisfies Prisma.OptionGroupInclude;

export type OptionGroupRow = Prisma.OptionGroupGetPayload<{
  include: typeof withValues;
}>;

@Injectable()
export class ProductOptionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<OptionGroupRow[]> {
    return this.prisma.optionGroup.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: withValues,
    });
  }

  findGroup(id: string): Promise<OptionGroupRow | null> {
    return this.prisma.optionGroup.findUnique({
      where: { id },
      include: withValues,
    });
  }

  createGroup(dto: SaveOptionGroupDto): Promise<OptionGroupRow> {
    return this.prisma.optionGroup.create({
      data: groupFields(dto),
      include: withValues,
    });
  }

  updateGroup(id: string, dto: SaveOptionGroupDto): Promise<OptionGroupRow> {
    return this.prisma.optionGroup.update({
      where: { id },
      data: groupFields(dto),
      include: withValues,
    });
  }

  async createValue(groupId: string, dto: SaveOptionValueDto): Promise<void> {
    await this.prisma.optionValue.create({
      data: { groupId, ...valueFields(dto) },
    });
  }

  /** Returns false when the value doesn't belong to the group. */
  async updateValue(
    groupId: string,
    id: string,
    dto: SaveOptionValueDto,
  ): Promise<boolean> {
    const { count } = await this.prisma.optionValue.updateMany({
      where: { id, groupId },
      data: valueFields(dto),
    });
    return count === 1;
  }
}

const groupFields = (dto: SaveOptionGroupDto) => {
  const text = dto.kind === OptionKind.TEXT;
  return {
    name: dto.name,
    kind: dto.kind,
    maxLength: text ? (dto.maxLength ?? null) : null,
    textExtraPrice: text ? dto.textExtraPrice : '0',
    sortOrder: dto.sortOrder,
    active: dto.active,
  };
};

const valueFields = (dto: SaveOptionValueDto) => ({
  label: dto.label,
  swatchHex: dto.swatchHex ?? null,
  gramsMultiplier: dto.gramsMultiplier,
  hoursMultiplier: dto.hoursMultiplier,
  extraPrice: dto.extraPrice,
  materialId: dto.materialId ?? null,
  sortOrder: dto.sortOrder,
  active: dto.active,
});
