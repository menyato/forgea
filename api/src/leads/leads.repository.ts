import { Injectable } from '@nestjs/common';
import type {
  CreateLeadDto,
  LeadListQuery,
  SaveLeadDto,
  SaveLeadStageDto,
  SaveLostReasonDto,
} from '@forgea/validation';
import { keysetPage } from '../common/pagination/keyset.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LeadStage, Prisma } from '../generated/prisma/client.js';
import type { ActivityKind, LeadSource } from '../generated/prisma/enums.js';

const person = { select: { id: true, email: true, name: true } } as const;

const withSummary = {
  stage: { select: { id: true, name: true, isWon: true } },
  assignedTo: person,
  activities: {
    where: { doneAt: null },
    orderBy: { dueAt: 'asc' },
    take: 1,
    select: { kind: true, summary: true, dueAt: true },
  },
} as const satisfies Prisma.LeadInclude;
export type LeadRow = Prisma.LeadGetPayload<{ include: typeof withSummary }>;

export type LeadDetailRow = Prisma.LeadGetPayload<{
  include: {
    stage: { select: { id: true; name: true; isWon: true } };
    assignedTo: typeof person;
    customer: typeof person;
    customRequest: { select: { requestNumber: true } };
    lostReason: { select: { name: true } };
    activities: {
      orderBy: { dueAt: 'asc' };
      include: { assignedTo: { select: { email: true } } };
    };
    notes: {
      orderBy: { createdAt: 'asc' };
      include: { author: { select: { email: true } } };
    };
    quotations: {
      select: { id: true; number: true; status: true; total: true };
    };
  };
}>;

export interface NewLead {
  name: string;
  email: string;
  phone: string | null;
  message: string;
  source: LeadSource;
  budgetRange?: string | null;
  referenceUploadId?: string | null;
  customerId?: string | null;
  customRequestId?: string | null;
  expectedRevenue?: string | null;
  deadline?: Date | null;
  assignedToId?: string | null;
}

@Injectable()
export class LeadsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** New leads start in the first open stage, at its probability. */
  async firstStage(): Promise<LeadStage> {
    return this.prisma.leadStage.findFirstOrThrow({
      where: { active: true, isWon: false },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async create(lead: NewLead, note: string): Promise<{ id: string }> {
    const stage = await this.firstStage();
    return this.prisma.lead.create({
      data: {
        ...lead,
        stageId: stage.id,
        probability: stage.defaultProbability,
        notes: { create: { body: note } },
      },
      select: { id: true },
    });
  }

  createFromForm(dto: CreateLeadDto, referenceUploadId: string | null) {
    return this.create(
      {
        name: dto.name,
        email: dto.email,
        phone: dto.phone ?? null,
        message: dto.message,
        budgetRange: dto.budgetRange ?? null,
        referenceUploadId,
        source: 'FORM',
      },
      'Sent from the custom-design form.',
    );
  }

  findById(id: string): Promise<LeadDetailRow | null> {
    return this.prisma.lead.findUnique({
      where: { id },
      include: {
        stage: { select: { id: true, name: true, isWon: true } },
        assignedTo: person,
        customer: person,
        customRequest: { select: { requestNumber: true } },
        lostReason: { select: { name: true } },
        activities: {
          orderBy: { dueAt: 'asc' },
          include: { assignedTo: { select: { email: true } } },
        },
        notes: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { email: true } } },
        },
        quotations: {
          select: { id: true, number: true, status: true, total: true },
        },
      },
    });
  }

  /** The first time someone in the team opens it; it stops being "New". */
  async markOpened(id: string): Promise<void> {
    await this.prisma.lead.updateMany({
      where: { id, openedAt: null },
      data: { openedAt: new Date() },
    });
  }

  /** Open leads nobody has opened yet. */
  countUnopened(): Promise<number> {
    return this.prisma.lead.count({
      where: { closedAt: null, openedAt: null },
    });
  }

  list(query: LeadListQuery) {
    const state: Prisma.LeadWhereInput =
      query.state === 'open'
        ? { closedAt: null }
        : query.state === 'won'
          ? { closedAt: { not: null }, stage: { isWon: true } }
          : { closedAt: { not: null }, lostReasonId: { not: null } };
    const where: Prisma.LeadWhereInput = {
      ...state,
      ...(query.stageId ? { stageId: query.stageId } : {}),
      ...(query.assignedToId ? { assignedToId: query.assignedToId } : {}),
      ...(query.unopened ? { openedAt: null } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { email: { contains: query.q.toLowerCase() } },
            ],
          }
        : {}),
    };
    return keysetPage<LeadRow>(
      {
        sortField: 'createdAt',
        kind: 'date',
        order: query.order,
        limit: query.limit,
        cursor: query.cursor,
        valueOf: (row) => row.createdAt,
      },
      ({ after, orderBy, take }) =>
        this.prisma.lead.findMany({
          where: { AND: [where, after as Prisma.LeadWhereInput] },
          orderBy: orderBy as Prisma.LeadOrderByWithRelationInput[],
          take,
          include: withSummary,
        }),
    );
  }

  /** A change and the line it adds to the lead's log, together. */
  async change(
    id: string,
    data: Prisma.LeadUncheckedUpdateInput,
    note: { body: string; authorId: string },
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.lead.update({ where: { id }, data }),
      this.prisma.leadNote.create({ data: { leadId: id, ...note } }),
    ]);
  }

  updateDetails(id: string, dto: SaveLeadDto) {
    return this.prisma.lead.update({
      where: { id },
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone ?? null,
        message: dto.message,
        expectedRevenue: dto.expectedRevenue ?? null,
        deadline: dto.deadline ? new Date(dto.deadline) : null,
        assignedToId: dto.assignedToId ?? null,
      },
    });
  }

  addNote(leadId: string, body: string, authorId: string | null) {
    return this.prisma.leadNote.create({ data: { leadId, body, authorId } });
  }

  addActivity(a: {
    leadId: string;
    kind: ActivityKind;
    summary: string;
    dueAt: Date;
    assignedToId: string | null;
    createdById: string;
  }) {
    return this.prisma.leadActivity.create({ data: a });
  }

  /** Marks it done and logs it; false when it was already done or isn't this lead's. */
  async completeActivity(
    leadId: string,
    id: string,
    authorId: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const activity = await tx.leadActivity.findFirst({
        where: { id, leadId, doneAt: null },
      });
      if (!activity) return false;
      await tx.leadActivity.update({
        where: { id },
        data: { doneAt: new Date() },
      });
      await tx.leadNote.create({
        data: {
          leadId,
          authorId,
          body: `Done: ${activity.kind.toLowerCase()} — ${activity.summary}`,
        },
      });
      return true;
    });
  }

  stage(id: string) {
    return this.prisma.leadStage.findUnique({ where: { id } });
  }

  stages() {
    return this.prisma.leadStage.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  saveStage(id: string | null, dto: SaveLeadStageDto) {
    return id
      ? this.prisma.leadStage.update({ where: { id }, data: dto })
      : this.prisma.leadStage.create({ data: dto });
  }

  lostReason(id: string) {
    return this.prisma.lostReason.findUnique({ where: { id } });
  }

  lostReasons() {
    return this.prisma.lostReason.findMany({ orderBy: { name: 'asc' } });
  }

  saveLostReason(id: string | null, dto: SaveLostReasonDto) {
    return id
      ? this.prisma.lostReason.update({ where: { id }, data: dto })
      : this.prisma.lostReason.create({ data: dto });
  }
}
