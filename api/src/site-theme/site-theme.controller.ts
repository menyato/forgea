import { Body, Controller, Delete, Get, Put } from '@nestjs/common';
import type { SiteTheme } from '@forgea/brand';
import { SaveSiteThemeDto } from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import { CurrentUser, Public, Roles } from '../authorization/decorators.js';
import { Role } from '../generated/prisma/enums.js';
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
  @Roles(Role.ADMIN)
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
  @Roles(Role.ADMIN)
  @Audit({
    action: 'site-theme.reset',
    targetType: 'SiteTheme',
    targetId: 'site',
  })
  @Delete()
  reset(): Promise<{ theme: SiteTheme | null }> {
    return this.themes.reset();
  }
}
