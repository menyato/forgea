import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  LeadDetail,
  LeadListItem,
  LeadStageView,
  LostReasonView,
  Page,
  TodoItem,
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
import { Notifications } from '../mail/notifications.service.js';
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
const CHANGED = 'Someone else just changed this lead. Reload and try again.';

@Injectable()
export class LeadsService {
  constructor(
    private readonly leads: LeadsRepository,
    private readonly uploads: UploadsService,
    private readonly notifications: Notifications,
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
    const lead = await this.leads.createFromForm(dto, referenceUploadId);
    // A fixed subject, and the visitor's words marked as theirs: anyone can fill this form, so
    // nothing they type may read as if the studio's own system wrote it.
    this.notifications.alertStudio(
      'New idea from the website form',
      [
        `From a visitor (not checked): name "${dto.name}", email ${dto.email}${dto.phone ? `, phone ${dto.phone}` : ''}.`,
        'Their message, as they wrote it:',
        `“${dto.message}”`,
      ],
      `/admin/leads/${lead.id}`,
    );
    return lead;
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
    // Whoever adds it has seen it.
    await this.leads.markOpened(id);
    return this.detail(id);
  }

  async list(query: LeadListQuery): Promise<Page<LeadListItem>> {
    return toPage(await this.leads.list(query), toListItem);
  }

  /** Opening a lead in the dashboard: it is no longer new. */
  async open(id: string): Promise<LeadDetail> {
    const lead = await this.detail(id);
    await this.leads.markOpened(id);
    return lead;
  }

  /** New leads nobody opened; my follow-ups due by the end of today (studio time) or late. */
  async counts(
    userId: string,
  ): Promise<{ unopened: number; followUpsDue: number }> {
    const [unopened, followUpsDue] = await Promise.all([
      this.leads.countUnopened(),
      this.leads.countDue(userId, endOfStudioDay()),
    ]);
    return { unopened, followUpsDue };
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
    const moved = await this.leads.change(
      id,
      {
        stageId,
        stageChangedAt: new Date(),
        probability: stage.isWon ? 100 : stage.defaultProbability,
        closedAt: stage.isWon ? new Date() : null,
        decisionNeeded: null,
      },
      {
        body: stage.isWon
          ? `Won (moved to ${stage.name}).`
          : `Moved to ${stage.name}.`,
        authorId: actorId,
      },
      { lostReasonId: null },
    );
    if (!moved) throw new ConflictException(CHANGED);
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
    const lost = await this.leads.change(
      id,
      {
        closedAt: new Date(),
        probability: 0,
        lostReasonId: reason.id,
        decisionNeeded: null,
      },
      {
        body: `Lost: ${reason.name}.${dto.note ? ` ${dto.note}` : ''}`,
        authorId: actorId,
      },
      { closedAt: null },
    );
    if (!lost) throw new ConflictException(CHANGED);
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
        decisionNeeded: null,
      },
      { body: `Reopened in ${stage.name}.`, authorId: actorId },
      { closedAt: { not: null } },
    );
    return this.detail(id);
  }

  /** The team decided the lead is not lost (e.g. after a declined quotation): it stays open. */
  async keepOpen(id: string, actorId: string): Promise<LeadDetail> {
    const lead = await this.require(id);
    if (!lead.decisionNeeded || lead.closedAt)
      throw new BadRequestException('Nothing is waiting on a decision here');
    await this.leads.change(
      id,
      { decisionNeeded: null },
      { body: 'Kept open.', authorId: actorId },
    );
    return this.detail(id);
  }

  /**
   * One of the lead's quotations changed: written in its log, and the lead follows. Sent: on
   * to the "quoted" stage (if it was earlier). Accepted: won. Declined by the customer: it
   * stays open and waits for the team to say whether it is lost. Never reopens a closed lead.
   * `actorId` null: the customer did it.
   */
  async quotationChanged(
    leadId: string,
    event: QuotationEvent,
    actorId: string | null,
  ): Promise<void> {
    const lead = await this.leads.findById(leadId);
    if (!lead) return;
    const open = lead.closedAt === null;
    const authorId = actorId;
    if (event.kind === 'sent') {
      const quoted = open ? await this.leads.markedStage('isQuoted') : null;
      const current = await this.leads.stage(lead.stageId);
      const moves =
        quoted !== null &&
        current !== null &&
        !current.isWon &&
        current.sortOrder < quoted.sortOrder;
      const moved = moves ? `: moved to ${quoted.name}` : '';
      await this.leads.change(
        leadId,
        moves
          ? {
              stageId: quoted.id,
              stageChangedAt: new Date(),
              probability: quoted.defaultProbability,
            }
          : {},
        {
          authorId,
          body: `Quotation ${event.number} sent (${usd(event.total)})${moved}.`,
        },
      );
      return;
    }
    if (event.kind === 'accepted') {
      const won = open ? await this.leads.markedStage('isWon') : null;
      const accepted = `Quotation ${event.number} accepted: order ${event.orderNumber}`;
      // Won only if still open (lost a moment ago stays lost); the log says it either way.
      const closed =
        won !== null &&
        (await this.leads.change(
          leadId,
          {
            stageId: won.id,
            stageChangedAt: new Date(),
            probability: 100,
            closedAt: new Date(),
            decisionNeeded: null,
          },
          { authorId, body: `${accepted}. Won (moved to ${won.name}).` },
          { closedAt: null },
        ));
      if (!closed)
        await this.leads.change(leadId, {}, { authorId, body: `${accepted}.` });
      return;
    }
    if (event.kind === 'declined') {
      const why = event.reason ? ` Their reason: "${event.reason}".` : '';
      await this.leads.change(
        leadId,
        open
          ? {
              decisionNeeded: `The customer declined quotation ${event.number}.${why} Mark the lead as lost, or keep it open.`,
            }
          : {},
        {
          authorId,
          body: `The customer declined quotation ${event.number}.${why}`,
        },
      );
      return;
    }
    await this.leads.change(
      leadId,
      {},
      { authorId, body: `Quotation ${event.number} cancelled.` },
    );
  }

  async addActivity(
    id: string,
    dto: AddActivityDto,
    actorId: string,
  ): Promise<LeadDetail> {
    await this.require(id);
    const dueAt = new Date(dto.dueAt);
    // A minute's grace for the time the form took to arrive.
    if (dueAt.getTime() < Date.now() - 60_000)
      throw new BadRequestException("A follow-up can't be in the past");
    await this.leads.addActivity({
      leadId: id,
      kind: dto.kind,
      summary: dto.summary,
      dueAt,
      assignedToId: dto.assignedToId ?? actorId,
      createdById: actorId,
    });
    return this.detail(id);
  }

  async todo(assignedToId: string | null): Promise<TodoItem[]> {
    return (await this.leads.openActivities(assignedToId)).map((a) => ({
      id: a.id,
      kind: a.kind,
      summary: a.summary,
      dueAt: a.dueAt.toISOString(),
      assignedTo: a.assignedTo?.email ?? null,
      lead: { id: a.lead.id, name: a.lead.name, stage: a.lead.stage.name },
    }));
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
      isQuoted: s.isQuoted,
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

/** What happened to one of a lead's quotations (see LeadsService.quotationChanged). */
export type QuotationEvent =
  | { kind: 'sent'; number: string; total: string }
  | { kind: 'accepted'; number: string; orderNumber: string }
  | { kind: 'declined'; number: string; reason: string | null }
  | { kind: 'cancelled'; number: string };

const usd = (amount: string) => '$' + amount;

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
    isNew: l.openedAt === null,
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
    decisionNeeded: l.decisionNeeded,
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

/** The end of today in the studio's time (Beirut), as an instant. */
export function endOfStudioDay(now = new Date()): Date {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Beirut',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(now)
      .map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>;
  const wall = Date.UTC(
    p['year']!,
    p['month']! - 1,
    p['day']!,
    p['hour']!,
    p['minute']!,
    p['second']!,
  );
  // The studio's offset from UTC now (+2 or +3), taken off the wall-clock midnight.
  const offset = wall - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(
    Date.UTC(p['year']!, p['month']! - 1, p['day']! + 1) - offset,
  );
}
