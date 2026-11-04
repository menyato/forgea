import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { LeadDetail, LeadListItem, Page } from '@forgea/types';
import {
  AddActivityDto,
  AddNoteDto,
  CreateLeadDto,
  LeadListQuery,
  LoseLeadDto,
  MoveLeadDto,
  SaveLeadDto,
} from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import {
  CurrentUser,
  Public,
  RequirePermission,
} from '../authorization/decorators.js';
import { UploadPurpose } from '../generated/prisma/enums.js';
import { THROTTLE } from '../security/throttle-policies.js';
import { UPLOAD_POLICIES } from '../uploads/upload-policies.js';
import { UploadSlots } from '../uploads/upload-slots.interceptor.js';
import { LeadsService } from './leads.service.js';

/** The public custom-design form, and the team's sales pipeline (staff and admins). */
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @RequirePermission('leads.view')
  @Get()
  list(@Query() query: LeadListQuery): Promise<Page<LeadListItem>> {
    return this.leads.list(query);
  }

  /** Public custom-design form (multipart: fields + optional "referenceImage"). */
  @Public()
  @Throttle(THROTTLE.lead)
  @Post()
  @UseInterceptors(
    UploadSlots,
    FileInterceptor('referenceImage', {
      // Rejected while streaming, before the whole body is buffered.
      limits: {
        fileSize: UPLOAD_POLICIES[UploadPurpose.LEAD_REFERENCE].maxBytes,
        files: 1,
        fields: 10,
        parts: 11,
      },
    }),
  )
  submit(
    @Body() dto: CreateLeadDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ id: string }> {
    return this.leads.submit(
      dto,
      file && { data: file.buffer, originalName: file.originalname },
    );
  }

  /** A lead the team adds (a call, a fair, a referral). */
  @RequirePermission('leads.manage')
  @Audit({ action: 'lead.create', targetType: 'Lead' })
  @Post('manual')
  createManual(
    @Body() dto: SaveLeadDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LeadDetail> {
    return this.leads.createManual(dto, user.id);
  }

  /** Leads nobody has opened yet: the "New" tab's number. */
  @RequirePermission('leads.view')
  @Get('counts')
  counts(): Promise<{ unopened: number }> {
    return this.leads.counts();
  }

  /** Opening it in the dashboard marks it as seen (no longer "New"). */
  @RequirePermission('leads.view')
  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<LeadDetail> {
    return this.leads.open(id);
  }

  @RequirePermission('leads.manage')
  @Audit({ action: 'lead.update', targetType: 'Lead' })
  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveLeadDto,
  ): Promise<LeadDetail> {
    return this.leads.update(id, dto);
  }

  @RequirePermission('leads.manage')
  @Audit({ action: 'lead.stage', targetType: 'Lead' })
  @HttpCode(200)
  @Post(':id/stage')
  move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveLeadDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LeadDetail> {
    return this.leads.move(id, dto.stageId, user.id);
  }

  @RequirePermission('leads.manage')
  @Audit({ action: 'lead.lose', targetType: 'Lead' })
  @HttpCode(200)
  @Post(':id/lose')
  lose(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LoseLeadDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LeadDetail> {
    return this.leads.lose(id, dto, user.id);
  }

  /** After a declined quotation: the team says the lead is not lost. */
  @RequirePermission('leads.manage')
  @Audit({ action: 'lead.keep-open', targetType: 'Lead' })
  @HttpCode(200)
  @Post(':id/keep-open')
  keepOpen(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LeadDetail> {
    return this.leads.keepOpen(id, user.id);
  }

  @RequirePermission('leads.manage')
  @Audit({ action: 'lead.restore', targetType: 'Lead' })
  @HttpCode(200)
  @Post(':id/restore')
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LeadDetail> {
    return this.leads.restore(id, user.id);
  }

  @RequirePermission('leads.manage')
  @Post(':id/activities')
  addActivity(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddActivityDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LeadDetail> {
    return this.leads.addActivity(id, dto, user.id);
  }

  @RequirePermission('leads.manage')
  @HttpCode(200)
  @Post(':id/activities/:activityId/done')
  completeActivity(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LeadDetail> {
    return this.leads.completeActivity(id, activityId, user.id);
  }

  @RequirePermission('leads.manage')
  @Post(':id/notes')
  addNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LeadDetail> {
    return this.leads.addNote(id, dto.body, user.id);
  }
}
