import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { StoreSettingsModule } from '../store-settings/store-settings.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { FontsController } from './fonts.controller.js';
import { FontsRepository } from './fonts.repository.js';
import { FontsService } from './fonts.service.js';
import { PrintFilesController } from './print-files.controller.js';
import { PrintFiles } from './print-files.js';
import { TextShaper } from './text-shaper.js';
import { TextStudio } from './text-studio.service.js';

/** Personalised products: fonts, designs measured in a worker, their prices and print files. */
@Module({
  imports: [DatabaseModule, UploadsModule, StoreSettingsModule],
  controllers: [FontsController, PrintFilesController],
  providers: [
    FontsRepository,
    FontsService,
    PrintFiles,
    TextShaper,
    TextStudio,
  ],
  // The catalog importer adds fonts the way the Fonts page does.
  exports: [TextStudio, FontsService],
})
export class TextStudioModule {}
