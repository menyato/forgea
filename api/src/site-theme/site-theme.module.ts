import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { SiteThemeController } from './site-theme.controller.js';
import { SiteThemeRepository } from './site-theme.repository.js';
import { SiteThemeService } from './site-theme.service.js';

/** The owner's palette for the site and the logo (theme control, Phase 8). */
@Module({
  imports: [DatabaseModule],
  controllers: [SiteThemeController],
  providers: [SiteThemeService, SiteThemeRepository],
})
export class SiteThemeModule {}
