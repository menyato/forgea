import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import type { OrderProduction, Permission } from '@forgea/types';
import {
  CallerPermissions,
  RequirePermission,
} from '../authorization/decorators.js';
import { OrderProductionService } from './order-production.service.js';

/**
 * An order's production summary for its page (Dashboard → Orders): filament by colour and
 * print time for whoever sees orders; its cost and profit only for those who see the books.
 */
@Controller('orders')
export class OrderProductionController {
  constructor(private readonly production: OrderProductionService) {}

  @RequirePermission('orders.view')
  @Get(':id/production')
  forOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CallerPermissions() permissions: Permission[],
  ): Promise<OrderProduction> {
    return this.production.forOrder(id, permissions.includes('books.view'));
  }
}
