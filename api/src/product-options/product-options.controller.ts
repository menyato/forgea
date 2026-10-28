import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import type { OptionGroupView } from '@forgea/types';
import { SaveOptionGroupDto, SaveOptionValueDto } from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import { Roles } from '../authorization/decorators.js';
import { Role } from '../generated/prisma/enums.js';
import { ProductOptionsService } from './product-options.service.js';

/**
 * Dashboard: option groups and their values with price rules. Admin only and audit-logged;
 * shoppers see a product's options (never the rules) on GET /products/:slug.
 */
@Roles(Role.DESIGNER)
@Controller('option-groups')
export class ProductOptionsController {
  constructor(private readonly options: ProductOptionsService) {}

  @Get()
  list(): Promise<OptionGroupView[]> {
    return this.options.list();
  }

  @Audit({ action: 'option-group.create', targetType: 'OptionGroup' })
  @Post()
  createGroup(@Body() dto: SaveOptionGroupDto): Promise<OptionGroupView> {
    return this.options.createGroup(dto);
  }

  @Audit({ action: 'option-group.update', targetType: 'OptionGroup' })
  @Put(':id')
  updateGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveOptionGroupDto,
  ): Promise<OptionGroupView> {
    return this.options.updateGroup(id, dto);
  }

  @Audit({ action: 'option-value.create', targetType: 'OptionGroup' })
  @Post(':id/values')
  addValue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveOptionValueDto,
  ): Promise<OptionGroupView> {
    return this.options.addValue(id, dto);
  }

  @Audit({
    action: 'option-value.update',
    targetType: 'OptionValue',
    targetParam: 'valueId',
  })
  @Put(':id/values/:valueId')
  updateValue(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('valueId', ParseUUIDPipe) valueId: string,
    @Body() dto: SaveOptionValueDto,
  ): Promise<OptionGroupView> {
    return this.options.updateValue(id, valueId, dto);
  }
}
