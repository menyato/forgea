import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { OptionGroupView } from '@forgea/types';
import type {
  SaveOptionGroupDto,
  SaveOptionValueDto,
} from '@forgea/validation';
import { OptionKind } from '../generated/prisma/enums.js';
import {
  type OptionGroupRow,
  ProductOptionsRepository,
} from './product-options.repository.js';

/**
 * The options customers choose (colour, size, material, a name to print…) and what each
 * choice does to the price. Nothing here is hard-coded: the owner defines it all.
 */
@Injectable()
export class ProductOptionsService {
  constructor(private readonly options: ProductOptionsRepository) {}

  async list(): Promise<OptionGroupView[]> {
    return (await this.options.list()).map(toView);
  }

  async createGroup(dto: SaveOptionGroupDto): Promise<OptionGroupView> {
    return toView(await this.options.createGroup(dto));
  }

  async updateGroup(
    id: string,
    dto: SaveOptionGroupDto,
  ): Promise<OptionGroupView> {
    const group = await this.requireGroup(id);
    // Values only make sense for a choice: a group that has some can't become a text box.
    if (dto.kind === OptionKind.TEXT && group.values.length > 0) {
      throw new BadRequestException(
        'A group with choices cannot become a text option',
      );
    }
    return toView(await this.options.updateGroup(id, dto));
  }

  async addValue(
    groupId: string,
    dto: SaveOptionValueDto,
  ): Promise<OptionGroupView> {
    const group = await this.requireGroup(groupId);
    if (group.kind === OptionKind.TEXT) {
      throw new BadRequestException('Text options have no choices');
    }
    await this.options.createValue(groupId, dto);
    return toView(await this.requireGroup(groupId));
  }

  async updateValue(
    groupId: string,
    id: string,
    dto: SaveOptionValueDto,
  ): Promise<OptionGroupView> {
    if (!(await this.options.updateValue(groupId, id, dto))) {
      throw new NotFoundException('Option value not found');
    }
    return toView(await this.requireGroup(groupId));
  }

  private async requireGroup(id: string): Promise<OptionGroupRow> {
    const group = await this.options.findGroup(id);
    if (!group) throw new NotFoundException('Option group not found');
    return group;
  }
}

function toView(g: OptionGroupRow): OptionGroupView {
  return {
    id: g.id,
    name: g.name,
    kind: g.kind,
    maxLength: g.maxLength,
    textExtraPrice: g.textExtraPrice.toFixed(2),
    sortOrder: g.sortOrder,
    active: g.active,
    values: g.values.map((v) => ({
      id: v.id,
      label: v.label,
      swatchHex: v.swatchHex,
      gramsMultiplier: v.gramsMultiplier.toString(),
      hoursMultiplier: v.hoursMultiplier.toString(),
      extraPrice: v.extraPrice.toFixed(2),
      materialId: v.materialId,
      sortOrder: v.sortOrder,
      active: v.active,
    })),
  };
}
