import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { BackupsController } from './backups.controller.js';
import { BackupsService } from './backups.service.js';

/** The dashboard's Backups page (the server's backup.sh does the work). */
@Module({
  imports: [DatabaseModule],
  controllers: [BackupsController],
  providers: [BackupsService],
})
export class BackupsModule {}
