import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuditLogService } from './audit-log.service.js';
import { AuditInterceptor } from './audit.interceptor.js';
import { AuditLogController } from './audit-log.controller.js';

/** Global so any feature can mark routes with @Audit() or record entries directly. */
@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [AuditLogController],
  providers: [AuditLogService, AuditInterceptor],
  exports: [AuditLogService, AuditInterceptor],
})
export class AuditLogModule {}
