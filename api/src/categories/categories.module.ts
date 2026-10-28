import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { CategoriesController } from './categories.controller.js';
import { CategoriesRepository } from './categories.repository.js';
import { CategoriesService } from './categories.service.js';

/** Shop sections, managed in the dashboard. */
@Module({
  imports: [DatabaseModule],
  controllers: [CategoriesController],
  // The catalog importer reuses the same service, so imported data meets the same rules.
  exports: [CategoriesService],
  providers: [CategoriesService, CategoriesRepository],
})
export class CategoriesModule {}
