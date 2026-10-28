import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  LeadDetail,
  LeadListItem,
  LeadStageView,
  LostReasonView,
  Page,
} from '@forgea/types';
import type {
  AddActivityDto,
  CreateLeadDto,
  LeadListQuery,
  LoseLeadDto,
  SaveLeadDto,
  SaveLeadStageDto,
  SaveLostReasonDto,
} from '@forgea/validation';
import { toPage } from '../common/pagination/keyset.js';
import { UploadPurpose, UploadStatus } from '../generated/prisma/enums.js';
import {
  type IncomingFile,
  UploadsService,
} from '../uploads/uploads.service.js';
import {
  type LeadDetailRow,
  type LeadRow,
  LeadsRepository,
} from './leads.repository.js';

/**
 * The sales pipeline (Odoo CRM): leads move through the owner's stages; won in the won stage,
 * lost with a reason, reopened if needed. Every move is written in the lead's log, with who
 * made it.
 */
@Injectable()
export class LeadsService {
  constructor(
    private readonly leads: LeadsRepository,
    private readonly uploads: UploadsService,
  ) {}

  /** A public custom-design inquiry. A rejected reference image rejects the whole submission. */
  async submit(
    dto: CreateLeadDto,
    referenceImage: IncomingFile | undefined,
  ): Promise<{ id: string }> {
    let referenceUploadId: string | null = null;
    if (referenceImage) {
      const upload = await this.uploads.receive(
        referenceImage,
        UploadPurpose.LEAD_REFERENCE,
        null,
      );
      if (upload.status !== UploadStatus.CLEAN) {
        throw new BadRequestException(
          upload.rejectionReason ?? 'This file was not accepted',
        );
      }
      referenceUploadId = upload.id;
    }
    return this.leads.createFromForm(dto, referenceUploadId);
  }

  /** A customer's custom request also opens a lead, so it shows in the pipeline. */
  fromCustomRequest(r: {
    id: string;
    requestNumber: string;
    title: string;
    description: string;
    customer: {
      id: string;
      email: string;
      name: string | null;
      phone: string | null;
    };
  }): Promise<{ id: string }> {
    return this.leads.create(
      {
        name: r.customer.name ?? r.customer.email,
        email: r.customer.email,
        phone: r.customer.phone,
        message: `${r.title}\n\n${r.description}`,
        source: 'CUSTOM_REQUEST',
        customerId: r.customer.id,
        customRequestId: r.id,
      },
      `From custom request ${r.requestNumber}.`,
    );
  }

  async createManual(dto: SaveLeadDto, actorId: string): Promise<LeadDetail> {
    const { id } = await this.leads.create(
      {
        name: dto.name,
        email: dto.email,
        phone: dto.phone ?? null,
        message: dto.message,
        source: 'MANUAL',
        expectedRevenue: dto.expectedRevenue ?? null,
        deadline: dto.deadline ? new Date(dto.deadline) : null,
        assignedToId: dto.assignedToId ?? null,
      },
      'Added by the team.',
    );
    await this.leads.addNote(id, 'Lead created.', actorId);
    return this.detail(id);
  }

  async list(query: LeadListQuery): Promise<Page<LeadListItem>> {
    return toPage(await this.leads.list(query), toListItem);
  }

  async detail(id: string): Promise<LeadDetail> {
    const l = await this.leads.findById(id);
    if (!l) throw new NotFoundException('Lead not found');
    return toDetail(l);
  }

  async update(id: string, dto: SaveLeadDto): Promise<LeadDetail> {
    await this.require(id);
    await this.leads.updateDetails(id, dto);
    return this.detail(id);
  }

  /** Into another stage: its probability; the won stage wins (and closes) the lead. */
  async move(
    id: string,
    stageId: string,
    actorId: string,
  ): Promise<LeadDetail> {
    const lead = await this.require(id);
    const stage = await this.leads.stage(stageId);
    if (!stage || !stage.active)
      throw new BadRequestException('Choose an active stage');
    if (lead.lostReasonId) {
      throw new BadRequestException('Reopen the lost lead before moving it');
    }
    await this.leads.change(
      id,
      {
        stageId,
        stageChangedAt: new Date(),
        probability: stage.isWon ? 100 : stage.defaultProbability,
        closedAt: stage.isWon ? new Date() : null,
      },
      {
        body: stage.isWon
          ? `Won (moved to ${stage.name}).`
          : `Moved to ${stage.name}.`,
        authorId: actorId,
      },
    );
    return this.detail(id);
  }

  async lose(
    id: string,
    dto: LoseLeadDto,
    actorId: string,
  ): Promise<LeadDetail> {
    const lead = await this.require(id);
    if (lead.closedAt)
      throw new BadRequestException('This lead is already closed');
    const reason = await this.leads.lostReason(dto.lostReasonId);
    if (!reason || !reason.active)
      throw new BadRequestException('Choose a reason');
    await this.leads.change(
      id,
      { closedAt: new Date(), probability: 0, lostReasonId: reason.id },
      {
        body: `Lost: ${reason.name}.${dto.note ? ` ${dto.note}` : ''}`,
        authorId: actorId,
      },
    );
    return this.detail(id);
  }

  /** Reopens a won or lost lead in the first open stage. */
  async restore(id: string, actorId: string): Promise<LeadDetail> {
    const lead = await this.require(id);
    if (!lead.closedAt) throw new BadRequestException('This lead is open');
    const stage = await this.leads.firstStage();
    await this.leads.change(
      id,
      {
        closedAt: null,
        lostReasonId: null,
        stageId: stage.id,
        stageChangedAt: new Date(),
        probability: stage.defaultProbability,
      },
      { body: `Reopened in ${stage.name}.`, authorId: actorId },
    );
    return this.detail(id);
  }

  async addActivity(
    id: string,
    dto: AddActivityDto,
    actorId: string,
  ): Promise<LeadDetail> {
    await this.require(id);
    await this.leads.addActivity({
      leadId: id,
      kind: dto.kind,
      summary: dto.summary,
      dueAt: new Date(dto.dueAt),
      assignedToId: dto.assignedToId ?? actorId,
      createdById: actorId,
    });
    return this.detail(id);
  }

  async completeActivity(
    id: string,
    activityId: string,
    actorId: string,
  ): Promise<LeadDetail> {
    if (!(await this.leads.completeActivity(id, activityId, actorId))) {
      throw new NotFoundException('Follow-up not found, or already done');
    }
    return this.detail(id);
  }

  async addNote(
    id: string,
    body: string,
    actorId: string,
  ): Promise<LeadDetail> {
    await this.require(id);
    await this.leads.addNote(id, body, actorId);
    return this.detail(id);
  }

  async stages(): Promise<LeadStageView[]> {
    return (await this.leads.stages()).map((s) => ({
      id: s.id,
      name: s.name,
      sortOrder: s.sortOrder,
      isWon: s.isWon,
      defaultProbability: s.defaultProbability,
      active: s.active,
    }));
  }

  async saveStage(
    id: string | null,
    dto: SaveLeadStageDto,
  ): Promise<LeadStageView[]> {
    if (id && !(await this.leads.stage(id)))
      throw new NotFoundException('Stage not found');
    await this.leads.saveStage(id, dto);
    return this.stages();
  }

  async lostReasons(): Promise<LostReasonView[]> {
    return (await this.leads.lostReasons()).map((r) => ({
      id: r.id,
      name: r.name,
      active: r.active,
    }));
  }

  async saveLostReason(
    id: string | null,
    dto: SaveLostReasonDto,
  ): Promise<LostReasonView[]> {
    if (id && !(await this.leads.lostReason(id)))
      throw new NotFoundException('Reason not found');
    await this.leads.saveLostReason(id, dto);
    return this.lostReasons();
  }

  private async require(id: string): Promise<LeadDetailRow> {
    const lead = await this.leads.findById(id);
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }
}

function stateOf(l: { closedAt: Date | null; lostReasonId: string | null }) {
  if (!l.closedAt) return 'open' as const;
  return l.lostReasonId ? ('lost' as const) : ('won' as const);
}

function toListItem(l: LeadRow): LeadListItem {
  const next = l.activities[0];
  return {
    id: l.id,
    name: l.name,
    email: l.email,
    phone: l.phone,
    messagePreview: l.message.slice(0, 200),
    source: l.source,
    stage: l.stage,
    state: stateOf(l),
    probability: l.probability,
    expectedRevenue: l.expectedRevenue?.toFixed(2) ?? null,
    proratedRevenue: l.expectedRevenue
      ? l.expectedRevenue.times(l.probability).div(100).toFixed(2)
      : null,
    deadline: l.deadline?.toISOString().slice(0, 10) ?? null,
    assignedTo: l.assignedTo,
    nextActivity: next
      ? {
          kind: next.kind,
          summary: next.summary,
          dueAt: next.dueAt.toISOString(),
        }
      : null,
    createdAt: l.createdAt.toISOString(),
  };
}

function toDetail(l: LeadDetailRow): LeadDetail {
  const open = l.activities.filter((a) => !a.doneAt);
  return {
    ...toListItem({ ...l, activities: open.slice(0, 1) }),
    message: l.message,
    budgetRange: l.budgetRange,
    hasReferenceImage: l.referenceUploadId !== null,
    customer: l.customer,
    customRequestNumber: l.customRequest?.requestNumber ?? null,
    lostReason: l.lostReason?.name ?? null,
    closedAt: l.closedAt?.toISOString() ?? null,
    activities: l.activities.map((a) => ({
      id: a.id,
      kind: a.kind,
      summary: a.summary,
      dueAt: a.dueAt.toISOString(),
      doneAt: a.doneAt?.toISOString() ?? null,
      assignedTo: a.assignedTo?.email ?? null,
    })),
    notes: l.notes.map((n) => ({
      id: n.id,
      body: n.body,
      author: n.author?.email ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
    quotations: l.quotations.map((q) => ({
      id: q.id,
      number: q.number,
      status: q.status,
      total: q.total.toFixed(2),
    })),
  };
}
