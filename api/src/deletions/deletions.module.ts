import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { DeletionsController } from './deletions.controller.js';
import { DeletionsService } from './deletions.service.js';

/** Deleting dashboard records, refused while history still uses them. */
@Module({
  imports: [DatabaseModule],
  controllers: [DeletionsController],
  providers: [DeletionsService],
})
export class DeletionsModule {}
