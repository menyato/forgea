import { Controller, Get, Query } from '@nestjs/common';
import type { AuditLogListItem, Page } from '@forgea/types';
import { AuditLogListQuery } from '@forgea/validation';
import { Roles } from '../authorization/decorators.js';
import { Role } from '../generated/prisma/enums.js';
import { AuditLogService } from './audit-log.service.js';

@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly audit: AuditLogService) {}

  /** Admin only. Read-only: there is no route that changes or deletes entries. */
  @Roles(Role.ADMIN)
  @Get()
  list(@Query() query: AuditLogListQuery): Promise<Page<AuditLogListItem>> {
    return this.audit.list(query);
  }
}
