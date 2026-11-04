import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import type { RelatedRecord } from '@forgea/types';
import { RequirePermission } from '../authorization/decorators.js';
import { RelatedRecords } from './related.service.js';

/** The dashboard's "Related" links: whoever may open a record sees what it connects to. */
@Controller('related')
export class RelatedController {
  constructor(private readonly related: RelatedRecords) {}

  @RequirePermission('orders.view')
  @Get('order/:id')
  order(@Param('id', ParseUUIDPipe) id: string): Promise<RelatedRecord[]> {
    return this.related.order(id);
  }

  @RequirePermission('quotations.view')
  @Get('quotation/:id')
  quotation(@Param('id', ParseUUIDPipe) id: string): Promise<RelatedRecord[]> {
    return this.related.quotation(id);
  }

  @RequirePermission('leads.view')
  @Get('lead/:id')
  lead(@Param('id', ParseUUIDPipe) id: string): Promise<RelatedRecord[]> {
    return this.related.lead(id);
  }

  @RequirePermission('requests.view')
  @Get('request/:id')
  request(@Param('id', ParseUUIDPipe) id: string): Promise<RelatedRecord[]> {
    return this.related.request(id);
  }
}
