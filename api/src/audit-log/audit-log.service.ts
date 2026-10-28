import { Injectable } from '@nestjs/common';
import type { AuditLogListItem, Page } from '@forgea/types';
import type { AuditLogListQuery } from '@forgea/validation';
import { dateRange } from '../common/pagination/date-range.js';
import { keysetPage, toPage } from '../common/pagination/keyset.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

const withActor = {
  actor: { select: { id: true, email: true } },
} as const satisfies Prisma.AuditLogInclude;
type AuditRow = Prisma.AuditLogGetPayload<{ include: typeof withActor }>;

export interface AuditEntry {
  /** Null for system actions. */
  actorUserId: string | null;
  /** Dotted verb, e.g. "order.status.change". */
  action: string;
  targetType: string;
  targetId: string;
  ipAddress: string | null;
  /** Context such as before/after values. Never secrets, tokens or password hashes. */
  metadata?: Prisma.InputJsonValue;
}

/** Append-only audit trail. There is deliberately no update or delete method. */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorUserId: entry.actorUserId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        ipAddress: isRecordableIp(entry.ipAddress) ? entry.ipAddress : null,
        ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
      },
    });
  }

  /** Read-only listing for the admin audit viewer. */
  async list(query: AuditLogListQuery): Promise<Page<AuditLogListItem>> {
    const when = dateRange(query.from, query.to);
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(when ? { timestamp: when } : {}),
    };
    const page = await keysetPage<AuditRow>(
      {
        sortField: query.sort,
        kind: 'date',
        order: query.order,
        limit: query.limit,
        cursor: query.cursor,
        valueOf: (row) => row.timestamp,
      },
      ({ after, orderBy, take }) =>
        this.prisma.auditLog.findMany({
          where: { AND: [where, after as Prisma.AuditLogWhereInput] },
          orderBy: orderBy as Prisma.AuditLogOrderByWithRelationInput[],
          take,
          include: withActor,
        }),
    );
    return toPage(page, (a) => ({
      id: a.id,
      actor: a.actor,
      action: a.action,
      targetType: a.targetType,
      targetId: a.targetId,
      ipAddress: a.ipAddress,
      timestamp: a.timestamp.toISOString(),
    }));
  }
}

/** The column is INET; anything that isn't an address (e.g. "unknown") is stored as null. */
function isRecordableIp(ip: string | null): ip is string {
  return ip !== null && /^[0-9a-f.:]+$/i.test(ip);
}
