import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import type { SavedThemeView, SiteTheme } from '@forgea/brand';
import {
  ApplyThemeDto,
  SaveNamedThemeDto,
  SaveSiteThemeDto,
} from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import {
  CurrentUser,
  Public,
  RequirePermission,
} from '../authorization/decorators.js';
import { SiteThemeService } from './site-theme.service.js';

@Controller('site-theme')
export class SiteThemeController {
  constructor(private readonly themes: SiteThemeService) {}

  /** Public: every page applies the owner's palette. */
  @Public()
  @Get()
  current(): Promise<{ theme: SiteTheme | null }> {
    return this.themes.current();
  }

  /** Admin only, audit-logged. Refused when a colour pair is not readable enough. */
  @RequirePermission('theme.manage')
  @Audit({
    action: 'site-theme.update',
    targetType: 'SiteTheme',
    targetId: 'site',
  })
  @Put()
  save(
    @Body() dto: SaveSiteThemeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ theme: SiteTheme | null }> {
    return this.themes.save(dto, user.id);
  }

  /** Admin only, audit-logged: back to the default palette. */
  @RequirePermission('theme.manage')
  @Audit({
    action: 'site-theme.reset',
    targetType: 'SiteTheme',
    targetId: 'site',
  })
  @Delete()
  reset(): Promise<{ theme: SiteTheme | null }> {
    return this.themes.reset();
  }

  @RequirePermission('theme.manage')
  @Get('saved')
  saved(): Promise<SavedThemeView[]> {
    return this.themes.saved();
  }

  /** Keeps a palette under a name (the same name replaces it); the site does not change. */
  @RequirePermission('theme.manage')
  @Audit({
    action: 'site-theme.saved.keep',
    targetType: 'SavedTheme',
    targetId: 'new',
  })
  @Post('saved')
  keep(
    @Body() dto: SaveNamedThemeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SavedThemeView[]> {
    return this.themes.keep(dto, user.id);
  }

  /** Every page, for everyone, uses this saved theme from the next page they open. */
  @RequirePermission('theme.manage')
  @Audit({ action: 'site-theme.saved.apply', targetType: 'SavedTheme' })
  @Post('saved/:id/apply')
  apply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyThemeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ theme: SiteTheme | null }> {
    return this.themes.apply(id, dto, user.id);
  }

  @RequirePermission('theme.manage')
  @Audit({ action: 'site-theme.saved.delete', targetType: 'SavedTheme' })
  @Delete('saved/:id')
  forget(@Param('id', ParseUUIDPipe) id: string): Promise<SavedThemeView[]> {
    return this.themes.forget(id);
  }
}
