import {
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Audit } from '../audit-log/audit.interceptor.js';
import { RequirePermission } from '../authorization/decorators.js';
import { DeletionsService } from './deletions.service.js';

/**
 * Deleting dashboard records. Each route needs the permission that manages that record; a
 * record still used by history (orders, stock, print runs, leads, products) is refused with
 * what uses it (409). Audited.
 */
@Controller()
export class DeletionsController {
  constructor(private readonly deletions: DeletionsService) {}

  @RequirePermission('catalog.manage')
  @Audit({ action: 'product.delete', targetType: 'Product' })
  @HttpCode(204)
  @Delete('products/:id')
  product(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.deletions.product(id);
  }

  @RequirePermission('catalog.manage')
  @Audit({ action: 'category.delete', targetType: 'Category' })
  @HttpCode(204)
  @Delete('categories/:id')
  category(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.deletions.category(id);
  }

  @RequirePermission('materials.manage')
  @Audit({ action: 'material.delete', targetType: 'Material' })
  @HttpCode(204)
  @Delete('materials/:id')
  material(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.deletions.material(id);
  }

  @RequirePermission('catalog.manage')
  @Audit({ action: 'option-group.delete', targetType: 'OptionGroup' })
  @HttpCode(204)
  @Delete('option-groups/:id')
  optionGroup(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.deletions.optionGroup(id);
  }

  @RequirePermission('catalog.manage')
  @Audit({ action: 'option-value.delete', targetType: 'OptionValue' })
  @HttpCode(204)
  @Delete('option-groups/values/:id')
  optionValue(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.deletions.optionValue(id);
  }

  @RequirePermission('stock.manage')
  @Audit({ action: 'stock.item.delete', targetType: 'StockItem' })
  @HttpCode(204)
  @Delete('stock/items/:id')
  stockItem(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.deletions.stockItem(id);
  }

  @RequirePermission('production.manage')
  @Audit({ action: 'printer.delete', targetType: 'Printer' })
  @HttpCode(204)
  @Delete('printers/:id')
  printer(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.deletions.printer(id);
  }

  @RequirePermission('leads.manage')
  @Audit({ action: 'lead.delete', targetType: 'Lead' })
  @HttpCode(204)
  @Delete('leads/:id')
  lead(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.deletions.lead(id);
  }

  @RequirePermission('pipeline.manage')
  @Audit({ action: 'lost-reason.delete', targetType: 'LostReason' })
  @HttpCode(204)
  @Delete('lost-reasons/:id')
  lostReason(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.deletions.lostReason(id);
  }

  @RequirePermission('pipeline.manage')
  @Audit({ action: 'lead-stage.delete', targetType: 'LeadStage' })
  @HttpCode(204)
  @Delete('lead-stages/:id')
  leadStage(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.deletions.leadStage(id);
  }
}
