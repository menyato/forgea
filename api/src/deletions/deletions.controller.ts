import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Audit } from '../audit-log/audit.interceptor.js';
import { RequirePermission } from '../authorization/decorators.js';
import type { DeletionImpact } from '@forgea/types';
import { DeletionsService } from './deletions.service.js';

/**
 * Deleting dashboard records. Each route needs the permission that manages that record; a
 * record still used by history (orders, stock, print runs, leads, products) is refused with
 * what uses it (409). Audited. `GET <route>/:id/deletion` says first, without deleting, what
 * would keep it, what would go with it and what would let go of it.
 */
@Controller()
export class DeletionsController {
  constructor(private readonly deletions: DeletionsService) {}

  @RequirePermission('catalog.manage')
  @Get('products/:id/deletion')
  productImpact(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeletionImpact> {
    return this.deletions.impact('product', id);
  }

  @RequirePermission('catalog.manage')
  @Audit({ action: 'product.delete', targetType: 'Product' })
  @HttpCode(204)
  @Delete('products/:id')
  product(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.deletions.delete('product', id);
  }

  @RequirePermission('catalog.manage')
  @Get('categories/:id/deletion')
  categoryImpact(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeletionImpact> {
    return this.deletions.impact('category', id);
  }

  @RequirePermission('catalog.manage')
  @Audit({ action: 'category.delete', targetType: 'Category' })
  @HttpCode(204)
  @Delete('categories/:id')
  category(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.deletions.delete('category', id);
  }

  @RequirePermission('materials.manage')
  @Get('materials/:id/deletion')
  materialImpact(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeletionImpact> {
    return this.deletions.impact('material', id);
  }

  @RequirePermission('materials.manage')
  @Audit({ action: 'material.delete', targetType: 'Material' })
  @HttpCode(204)
  @Delete('materials/:id')
  material(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.deletions.delete('material', id);
  }

  @RequirePermission('catalog.manage')
  @Get('option-groups/:id/deletion')
  optionGroupImpact(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeletionImpact> {
    return this.deletions.impact('optionGroup', id);
  }

  @RequirePermission('catalog.manage')
  @Audit({ action: 'option-group.delete', targetType: 'OptionGroup' })
  @HttpCode(204)
  @Delete('option-groups/:id')
  optionGroup(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.deletions.delete('optionGroup', id);
  }

  @RequirePermission('catalog.manage')
  @Get('option-groups/values/:id/deletion')
  optionValueImpact(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeletionImpact> {
    return this.deletions.impact('optionValue', id);
  }

  @RequirePermission('catalog.manage')
  @Audit({ action: 'option-value.delete', targetType: 'OptionValue' })
  @HttpCode(204)
  @Delete('option-groups/values/:id')
  optionValue(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.deletions.delete('optionValue', id);
  }

  @RequirePermission('stock.manage')
  @Get('stock/items/:id/deletion')
  stockItemImpact(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeletionImpact> {
    return this.deletions.impact('stockItem', id);
  }

  @RequirePermission('stock.manage')
  @Audit({ action: 'stock.item.delete', targetType: 'StockItem' })
  @HttpCode(204)
  @Delete('stock/items/:id')
  stockItem(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.deletions.delete('stockItem', id);
  }

  @RequirePermission('production.manage')
  @Get('printers/:id/deletion')
  printerImpact(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeletionImpact> {
    return this.deletions.impact('printer', id);
  }

  @RequirePermission('production.manage')
  @Audit({ action: 'printer.delete', targetType: 'Printer' })
  @HttpCode(204)
  @Delete('printers/:id')
  printer(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.deletions.delete('printer', id);
  }

  @RequirePermission('leads.manage')
  @Get('leads/:id/deletion')
  leadImpact(@Param('id', ParseUUIDPipe) id: string): Promise<DeletionImpact> {
    return this.deletions.impact('lead', id);
  }

  @RequirePermission('leads.manage')
  @Audit({ action: 'lead.delete', targetType: 'Lead' })
  @HttpCode(204)
  @Delete('leads/:id')
  lead(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.deletions.delete('lead', id);
  }

  @RequirePermission('pipeline.manage')
  @Get('lost-reasons/:id/deletion')
  lostReasonImpact(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeletionImpact> {
    return this.deletions.impact('lostReason', id);
  }

  @RequirePermission('pipeline.manage')
  @Audit({ action: 'lost-reason.delete', targetType: 'LostReason' })
  @HttpCode(204)
  @Delete('lost-reasons/:id')
  lostReason(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.deletions.delete('lostReason', id);
  }

  @RequirePermission('pipeline.manage')
  @Get('lead-stages/:id/deletion')
  leadStageImpact(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeletionImpact> {
    return this.deletions.impact('leadStage', id);
  }

  @RequirePermission('pipeline.manage')
  @Audit({ action: 'lead-stage.delete', targetType: 'LeadStage' })
  @HttpCode(204)
  @Delete('lead-stages/:id')
  leadStage(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.deletions.delete('leadStage', id);
  }
}
