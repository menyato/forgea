import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import type { LeadStageView, LostReasonView } from '@forgea/types';
import { SaveLeadStageDto, SaveLostReasonDto } from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import { Roles } from '../authorization/decorators.js';
import { Role } from '../generated/prisma/enums.js';
import { LeadsService } from './leads.service.js';

/** The pipeline's stages and lost reasons: staff read them, admins change them. */
@Controller()
export class PipelineSettingsController {
  constructor(private readonly leads: LeadsService) {}

  @Roles(Role.STAFF)
  @Get('lead-stages')
  stages(): Promise<LeadStageView[]> {
    return this.leads.stages();
  }

  @Roles(Role.ADMIN)
  @Audit({
    action: 'lead-stage.create',
    targetType: 'LeadStage',
    targetId: 'new',
  })
  @Post('lead-stages')
  createStage(@Body() dto: SaveLeadStageDto): Promise<LeadStageView[]> {
    return this.leads.saveStage(null, dto);
  }

  @Roles(Role.ADMIN)
  @Audit({ action: 'lead-stage.update', targetType: 'LeadStage' })
  @Put('lead-stages/:id')
  updateStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveLeadStageDto,
  ): Promise<LeadStageView[]> {
    return this.leads.saveStage(id, dto);
  }

  @Roles(Role.STAFF)
  @Get('lost-reasons')
  lostReasons(): Promise<LostReasonView[]> {
    return this.leads.lostReasons();
  }

  @Roles(Role.ADMIN)
  @Audit({
    action: 'lost-reason.create',
    targetType: 'LostReason',
    targetId: 'new',
  })
  @Post('lost-reasons')
  createReason(@Body() dto: SaveLostReasonDto): Promise<LostReasonView[]> {
    return this.leads.saveLostReason(null, dto);
  }

  @Roles(Role.ADMIN)
  @Audit({ action: 'lost-reason.update', targetType: 'LostReason' })
  @Put('lost-reasons/:id')
  updateReason(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveLostReasonDto,
  ): Promise<LostReasonView[]> {
    return this.leads.saveLostReason(id, dto);
  }
}
