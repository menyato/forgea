import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  StreamableFile,
} from '@nestjs/common';
import type { BackupsView } from '@forgea/types';
import { BackupKeepDto, RestoreBackupDto } from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import { AdminOnly, CurrentUser } from '../authorization/decorators.js';
import { BackupsService } from './backups.service.js';

/** The Backups page: admins only, every change in the audit log. */
@AdminOnly()
@Controller('backups')
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get()
  view(): Promise<BackupsView> {
    return this.backups.view();
  }

  @Audit({ action: 'backup.create', targetType: 'Backup', targetId: 'new' })
  @HttpCode(202)
  @Post()
  async backupNow(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.backups.backupNow(user.id);
  }

  @Audit({
    action: 'backup.settings',
    targetType: 'Backup',
    targetId: 'settings',
  })
  @HttpCode(204)
  @Put('settings')
  async keep(@Body() dto: BackupKeepDto): Promise<void> {
    await this.backups.setKeep(dto.keep);
  }

  @Audit({
    action: 'backup.restore',
    targetType: 'Backup',
    targetParam: 'file',
  })
  @HttpCode(202)
  @Post(':file/restore')
  async restore(
    @Param('file') file: string,
    @Body() dto: RestoreBackupDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.backups.restore(file, dto.confirm, user.id);
  }

  @Audit({ action: 'backup.delete', targetType: 'Backup', targetParam: 'file' })
  @HttpCode(202)
  @Delete(':file')
  async remove(
    @Param('file') file: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.backups.remove(file, user.id);
  }

  /** The encrypted file itself, to keep on a PC (restore it with the backup password). */
  @Get(':file/download')
  async download(@Param('file') file: string): Promise<StreamableFile> {
    const f = await this.backups.download(file);
    return new StreamableFile(f.stream, {
      type: 'application/x-tar',
      length: f.size,
      disposition: `attachment; filename="${f.name}"`,
    });
  }
}
