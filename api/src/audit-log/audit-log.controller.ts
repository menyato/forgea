import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type { AuditLogEntry, AuditLogListItem, Page } from '@forgea/types';
import { AuditLogListQuery } from '@forgea/validation';
import { RequirePermission } from '../authorization/decorators.js';
import { AuditLogService } from './audit-log.service.js';

@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly audit: AuditLogService) {}

  /** Admin only. Read-only: there is no route that changes or deletes entries. */
  @RequirePermission('audit.view')
  @Get()
  list(@Query() query: AuditLogListQuery): Promise<Page<AuditLogListItem>> {
    return this.audit.list(query);
  }

  @RequirePermission('audit.view')
  @Get(':id')
  one(@Param('id', ParseUUIDPipe) id: string): Promise<AuditLogEntry> {
    return this.audit.one(id);
  }
}
