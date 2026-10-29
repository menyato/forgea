import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { FileInspector } from './file-inspector.js';
import { FileStorage, LocalDiskStorage } from './file-storage.js';
import { ModelOptimizer } from './model-optimizer.js';
import { ModelVariants } from './model-variants.js';
import { UploadsService } from './uploads.service.js';
import { UploadsController } from './uploads.controller.js';
import { MediaController } from './media.controller.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    UploadsService,
    FileInspector,
    ModelOptimizer,
    ModelVariants,
    { provide: FileStorage, useClass: LocalDiskStorage },
  ],
  exports: [UploadsService, ModelOptimizer],
  controllers: [UploadsController, MediaController],
})
export class UploadsModule {}
