import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { StoreSettingsModule } from '../store-settings/store-settings.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { DesignSlots } from './design-slots.js';
import { FontsController } from './fonts.controller.js';
import { FontsRepository } from './fonts.repository.js';
import { FontsService } from './fonts.service.js';
import { LogosController } from './logos.controller.js';
import { LogosRepository } from './logos.repository.js';
import { LogosService } from './logos.service.js';
import { PrintFilesController } from './print-files.controller.js';
import { PrintFiles } from './print-files.js';
import { TextShaper } from './text-shaper.js';
import { TextStudio } from './text-studio.service.js';

/** Personalised products: fonts, designs measured in a worker, their prices and print files. */
@Module({
  imports: [DatabaseModule, UploadsModule, StoreSettingsModule],
  controllers: [FontsController, LogosController, PrintFilesController],
  providers: [
    DesignSlots,
    FontsRepository,
    FontsService,
    LogosRepository,
    LogosService,
    PrintFiles,
    TextShaper,
    TextStudio,
  ],
  // The catalog importer adds fonts the way the Fonts page does.
  exports: [TextStudio, FontsService, DesignSlots],
})
export class TextStudioModule {}
