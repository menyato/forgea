import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { MailModule } from '../mail/mail.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { LeadsController } from './leads.controller.js';
import { LeadsRepository } from './leads.repository.js';
import { LeadsService } from './leads.service.js';
import { PipelineSettingsController } from './pipeline-settings.controller.js';

/** The CRM (Phase 11): leads from the form, from custom requests and from the team. */
@Module({
  imports: [DatabaseModule, MailModule, UploadsModule],
  controllers: [LeadsController, PipelineSettingsController],
  providers: [LeadsService, LeadsRepository],
  // Custom requests open a lead when they arrive.
  exports: [LeadsService],
})
export class LeadsModule {}
