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
import { RequirePermission } from '../authorization/decorators.js';
import { LeadsService } from './leads.service.js';

/** The pipeline's stages and lost reasons: staff read them, admins change them. */
@Controller()
export class PipelineSettingsController {
  constructor(private readonly leads: LeadsService) {}

  @RequirePermission('leads.view')
  @Get('lead-stages')
  stages(): Promise<LeadStageView[]> {
    return this.leads.stages();
  }

  @RequirePermission('pipeline.manage')
  @Audit({
    action: 'lead-stage.create',
    targetType: 'LeadStage',
    targetId: 'new',
  })
  @Post('lead-stages')
  createStage(@Body() dto: SaveLeadStageDto): Promise<LeadStageView[]> {
    return this.leads.saveStage(null, dto);
  }

  @RequirePermission('pipeline.manage')
  @Audit({ action: 'lead-stage.update', targetType: 'LeadStage' })
  @Put('lead-stages/:id')
  updateStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveLeadStageDto,
  ): Promise<LeadStageView[]> {
    return this.leads.saveStage(id, dto);
  }

  @RequirePermission('leads.view')
  @Get('lost-reasons')
  lostReasons(): Promise<LostReasonView[]> {
    return this.leads.lostReasons();
  }

  @RequirePermission('pipeline.manage')
  @Audit({
    action: 'lost-reason.create',
    targetType: 'LostReason',
    targetId: 'new',
  })
  @Post('lost-reasons')
  createReason(@Body() dto: SaveLostReasonDto): Promise<LostReasonView[]> {
    return this.leads.saveLostReason(null, dto);
  }

  @RequirePermission('pipeline.manage')
  @Audit({ action: 'lost-reason.update', targetType: 'LostReason' })
  @Put('lost-reasons/:id')
  updateReason(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveLostReasonDto,
  ): Promise<LostReasonView[]> {
    return this.leads.saveLostReason(id, dto);
  }
}
