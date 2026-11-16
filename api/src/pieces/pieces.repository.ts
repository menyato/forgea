import { Injectable } from '@nestjs/common';
import type { PieceListQuery } from '@forgea/validation';
import { keysetPage } from '../common/pagination/keyset.js';
import { studioDayPlus, studioDayStart } from '../common/studio-day.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PieceStage } from '../generated/prisma/enums.js';

const account = { select: { id: true, name: true, email: true } } as const;

const pieceInclude = {
  product: { select: { modelFileKey: true } },
  orderItem: { select: { order: { select: { orderNumber: true } } } },
  holderUser: account,
} as const satisfies Prisma.PieceInclude;
export type PieceRow = Prisma.PieceGetPayload<{ include: typeof pieceInclude }>;

const detailInclude = {
  ...pieceInclude,
  moves: {
    orderBy: { at: 'asc' },
    include: {
      holderUser: account,
      by: { select: { name: true, email: true } },
    },
  },
} as const satisfies Prisma.PieceInclude;
export type PieceDetailRow = Prisma.PieceGetPayload<{
  include: typeof detailInclude;
}>;

/** A new print on the board (with its first move). */
export interface NewPiece {
  name: string;
  productId?: string | null;
  orderItemId?: string | null;
  quantity: number;
  stage: PieceStage;
  holder?: string | null;
  holderId?: string | null;
  note?: string | null;
  printedAt: Date;
  grams?: number | null;
  cost?: Prisma.Decimal | string | null;
  plan?: Prisma.InputJsonValue | null;
  createdById?: string | null;
}

export interface PieceChange {
  name?: string;
  quantity?: number;
  stage?: PieceStage;
  holder?: string | null;
  holderId?: string | null;
  note?: string | null;
  printedAt?: Date;
  grams?: number | null;
  cost?: Prisma.Decimal | string | null;
  plan?: Prisma.InputJsonValue | typeof Prisma.DbNull;
}

/** The board's filters (all but the page and the sort). */
function pieceWhere(
  q: Pick<PieceListQuery, 'stages' | 'from' | 'to' | 'holderId' | 'q'>,
): Prisma.PieceWhereInput {
  const has = { contains: q.q ?? '', mode: 'insensitive' } as const;
  return {
    ...(q.stages?.length ? { stage: { in: q.stages } } : {}),
    ...(q.holderId ? { holderId: q.holderId } : {}),
    ...(q.from || q.to
      ? {
          printedAt: {
            ...(q.from ? { gte: studioDayStart(q.from) } : {}),
            ...(q.to ? { lt: studioDayStart(studioDayPlus(q.to, 1)) } : {}),
          },
        }
      : {}),
    ...(q.q
      ? {
          OR: [
            { name: has },
            { holder: has },
            { note: has },
            { holderUser: { OR: [{ name: has }, { email: has }] } },
            { orderItem: { order: { orderNumber: has } } },
          ],
        }
      : {}),
  };
}

/** The "Where it is" board: every print, where it is and who has it. */
@Injectable()
export class PiecesRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(query: PieceListQuery) {
    const where = pieceWhere(query);
    return keysetPage<PieceRow>(
      {
        sortField: query.sort,
        kind: query.sort === 'name' ? 'string' : 'date',
        order: query.order,
        limit: query.limit,
        cursor: query.cursor,
        valueOf: (p) => (query.sort === 'name' ? p.name : p.printedAt),
      },
      ({ after, orderBy, take }) =>
        this.prisma.piece.findMany({
          where: { AND: [where, after as Prisma.PieceWhereInput] },
          orderBy: orderBy as Prisma.PieceOrderByWithRelationInput[],
          take,
          include: pieceInclude,
        }),
    );
  }

  /** Pieces per stage, and the totals, of what the other filters show. */
  async counts(query: Omit<PieceListQuery, 'stages'>) {
    const where = pieceWhere(query);
    const [byStage, totals] = await Promise.all([
      this.prisma.piece.groupBy({
        by: ['stage'],
        where,
        _count: { _all: true },
      }),
      this.prisma.piece.aggregate({
        where,
        _sum: { quantity: true, grams: true, cost: true },
      }),
    ]);
    return {
      stages: Object.fromEntries(byStage.map((r) => [r.stage, r._count._all])),
      pieces: totals._sum.quantity ?? 0,
      grams: totals._sum.grams ?? 0,
      cost: totals._sum.cost ?? new Prisma.Decimal(0),
    };
  }

  find(id: string): Promise<PieceDetailRow | null> {
    return this.prisma.piece.findUnique({
      where: { id },
      include: detailInclude,
    });
  }

  /** Everyone with an account, to choose who holds a piece: the team first, then customers. */
  accounts() {
    return this.prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }, { email: 'asc' }],
      take: 500,
    });
  }

  /** Someone with an account (a customer, or someone of the team), to hold a piece. */
  accountExists(id: string): Promise<boolean> {
    return this.prisma.user.count({ where: { id } }).then((n) => n > 0);
  }

  /** Adds a print to the board, where it starts. Inside the caller's transaction. */
  async add(tx: Prisma.TransactionClient, p: NewPiece): Promise<string> {
    const { id } = await tx.piece.create({
      data: {
        name: p.name.slice(0, 200),
        productId: p.productId ?? null,
        orderItemId: p.orderItemId ?? null,
        quantity: p.quantity,
        stage: p.stage,
        holder: p.holder ?? null,
        holderId: p.holderId ?? null,
        note: p.note ?? null,
        printedAt: p.printedAt,
        grams: p.grams ?? null,
        cost: p.cost ?? null,
        plan: p.plan ?? Prisma.DbNull,
        createdById: p.createdById ?? null,
        moves: {
          create: {
            stage: p.stage,
            holder: p.holder ?? null,
            holderId: p.holderId ?? null,
            byId: p.createdById ?? null,
            at: p.printedAt,
          },
        },
      },
      select: { id: true },
    });
    return id;
  }

  /**
   * Changes a piece; a new stage or holder adds a move (who moved it, when). `expected` guards
   * against two people moving it at once: null when someone else got there first.
   */
  async change(
    id: string,
    expected: Date,
    change: PieceChange,
    actorId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const run = async (db: Prisma.TransactionClient) => {
      const before = await db.piece.findUnique({ where: { id } });
      if (!before || before.updatedAt.getTime() !== expected.getTime())
        return false;
      const { count } = await db.piece.updateMany({
        where: { id, updatedAt: expected },
        data: change,
      });
      if (count === 0) return false;
      const stage = change.stage ?? before.stage;
      const holder =
        change.holder !== undefined ? change.holder : before.holder;
      const holderId =
        change.holderId !== undefined ? change.holderId : before.holderId;
      if (
        stage !== before.stage ||
        holder !== before.holder ||
        holderId !== before.holderId
      )
        await db.pieceMove.create({
          data: {
            pieceId: id,
            stage,
            holder,
            holderId,
            note: change.note ?? null,
            byId: actorId,
          },
        });
      return true;
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  /**
   * An order line came off the printer (its runs are done): its piece, once, at what its runs
   * really cost. A line of a paid order is the customer's: sold to them.
   */
  async forOrderLine(orderItemId: string): Promise<void> {
    const line = await this.prisma.orderItem.findUnique({
      where: { id: orderItemId },
      select: {
        name: true,
        productId: true,
        quantity: true,
        piece: { select: { id: true } },
        order: {
          select: {
            total: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
        printJobs: {
          where: { status: 'DONE' },
          select: {
            finishedAt: true,
            actualGrams: true,
            materialCost: true,
            electricityCost: true,
            wearCost: true,
          },
        },
      },
    });
    if (!line || line.piece || line.printJobs.length === 0) return;
    const jobs = line.printJobs;
    const sold = line.order.total.gt(0);
    const sum = (f: (j: (typeof jobs)[number]) => Prisma.Decimal | null) =>
      jobs.reduce((n, j) => n.plus(f(j) ?? 0), new Prisma.Decimal(0));
    const finished = jobs
      .map((j) => j.finishedAt?.getTime() ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);
    const customer = line.order.user;
    await this.prisma
      .$transaction(async (tx) => {
        await this.add(tx, {
          name: line.name,
          productId: line.productId,
          orderItemId,
          quantity: line.quantity,
          stage: sold ? PieceStage.SOLD : PieceStage.IN_LAB,
          ...(sold
            ? {
                holder: customer.name?.trim() || customer.email,
                holderId: customer.id,
              }
            : {}),
          printedAt: new Date(finished || Date.now()),
          grams: sum((j) => j.actualGrams)
            .round()
            .toNumber(),
          cost: sum((j) => j.materialCost)
            .plus(sum((j) => j.electricityCost))
            .plus(sum((j) => j.wearCost))
            .toFixed(2),
        });
      })
      .catch((error: unknown) => {
        // Two runs finishing at once: the other one added it.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          return;
        throw error;
      });
  }
}
