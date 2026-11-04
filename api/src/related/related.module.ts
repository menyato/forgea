import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { RelatedController } from './related.controller.js';
import { RelatedRecords } from './related.service.js';

/** Links between a lead, its quotations, orders, custom request and customer. */
@Module({
  imports: [DatabaseModule],
  controllers: [RelatedController],
  providers: [RelatedRecords],
})
export class RelatedModule {}
