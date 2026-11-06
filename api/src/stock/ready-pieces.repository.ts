import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { ReadyPieceMovementKind } from '../generated/prisma/enums.js';

/** Which pieces: a product with its colour and size, or a custom design. */
export interface PieceKind {
  productId: string | null;
  name: string;
  details: string;
}

export interface PiecesIn extends PieceKind {
  kind:
    | typeof ReadyPieceMovementKind.PRINTED
    | typeof ReadyPieceMovementKind.LEFT_OVER
    | typeof ReadyPieceMovementKind.ADDED;
  quantity: number;
  /** What one cost to make, USD. */
  unitCost: Prisma.Decimal | string;
  printJobId?: string | null;
  orderId?: string | null;
  note?: string | null;
  createdById?: string | null;
}

const withProduct = {
  product: { select: { id: true, name: true } },
} as const satisfies Prisma.ReadyPieceInclude;
export type ReadyPieceRow = Prisma.ReadyPieceGetPayload<{
  include: typeof withProduct;
}>;

const movementInclude = {
  order: { select: { id: true, orderNumber: true } },
  createdBy: { select: { email: true, name: true } },
} as const satisfies Prisma.ReadyPieceMovementInclude;
export type ReadyPieceMovementRow = Prisma.ReadyPieceMovementGetPayload<{
  include: typeof movementInclude;
}>;

/**
 * The shelf of pieces printed and not sold yet. Every change is a movement (append-only); a
 * database trigger moves the count and the average cost with it, and the count can't go
 * below zero, so two people taking the last piece can't both succeed.
 */
@Injectable()
export class ReadyPiecesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Pieces onto the shelf, in the caller's transaction. A job's pieces go on once. */
  async add(tx: Prisma.TransactionClient, p: PiecesIn): Promise<void> {
    if (p.quantity <= 0) return;
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "ready_pieces" ("id", "productId", "name", "details", "updatedAt")
      VALUES (gen_random_uuid(), ${p.productId}::uuid, ${p.name.slice(0, 200)},
              ${p.details.slice(0, 300)}, CURRENT_TIMESTAMP)
      ON CONFLICT ("productId", "name", "details")
      DO UPDATE SET "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "id"`;
    await tx.$executeRaw`
      INSERT INTO "ready_piece_movements"
        ("id", "readyPieceId", "kind", "quantity", "unitCost", "printJobId", "orderId", "note", "createdById")
      VALUES (gen_random_uuid(), ${row!.id}::uuid, ${p.kind}::"ReadyPieceMovementKind", ${p.quantity},
              ${new Prisma.Decimal(p.unitCost).toDecimalPlaces(2)}, ${p.printJobId ?? null}::uuid,
              ${p.orderId ?? null}::uuid, ${p.note ?? null}, ${p.createdById ?? null}::uuid)
      ON CONFLICT DO NOTHING`;
  }

  /** Pieces off the shelf at its average cost; refused when there aren't that many. */
  async take(m: {
    id: string;
    kind:
      | typeof ReadyPieceMovementKind.SOLD
      | typeof ReadyPieceMovementKind.USED
      | typeof ReadyPieceMovementKind.SCRAPPED;
    quantity: number;
    orderId: string | null;
    note: string | null;
    createdById: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const piece = await this.lock(tx, m.id);
      if (piece.onHand < m.quantity)
        throw new ConflictException(
          `Only ${piece.onHand} on the shelf: reload and try again`,
        );
      await tx.readyPieceMovement.create({
        data: {
          readyPieceId: m.id,
          kind: m.kind,
          quantity: -m.quantity,
          unitCost: piece.unitCost,
          orderId: m.orderId,
          note: m.note,
          createdById: m.createdById,
        },
      });
    });
  }

  /** The shelf counted: the difference is recorded (nothing when it matches). */
  async count(m: {
    id: string;
    counted: number;
    note: string | null;
    createdById: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const piece = await this.lock(tx, m.id);
      const difference = m.counted - piece.onHand;
      if (difference === 0) return;
      await tx.readyPieceMovement.create({
        data: {
          readyPieceId: m.id,
          kind: ReadyPieceMovementKind.COUNTED,
          quantity: difference,
          unitCost: piece.unitCost,
          note: m.note,
          createdById: m.createdById,
        },
      });
    });
  }

  /** The row, locked until the transaction ends (others wait instead of racing). */
  private async lock(tx: Prisma.TransactionClient, id: string) {
    const [piece] = await tx.$queryRaw<
      { onHand: number; unitCost: Prisma.Decimal }[]
    >`SELECT "onHand", "unitCost" FROM "ready_pieces" WHERE "id" = ${id}::uuid FOR UPDATE`;
    if (!piece)
      throw new ConflictException('These pieces are not on the shelf');
    return piece;
  }

  list(all: boolean): Promise<ReadyPieceRow[]> {
    return this.prisma.readyPiece.findMany({
      where: all ? {} : { onHand: { gt: 0 } },
      orderBy: [{ name: 'asc' }, { details: 'asc' }],
      include: withProduct,
    });
  }

  find(id: string) {
    return this.prisma.readyPiece.findUnique({
      where: { id },
      include: {
        ...withProduct,
        movements: {
          orderBy: { createdAt: 'desc' },
          take: 200,
          include: movementInclude,
        },
      },
    });
  }

  orderByNumber(orderNumber: string) {
    return this.prisma.order.findUnique({
      where: { orderNumber },
      select: { id: true },
    });
  }

  product(id: string) {
    return this.prisma.product.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
  }

  transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(run);
  }
}

/** "Colour: Red · Size: 18 × 12 × 9 cm · “Maya”": what tells an order line's pieces apart. */
export function pieceDetails(options: unknown, design: unknown): string {
  const parts: string[] = [];
  if (Array.isArray(options)) {
    for (const o of options as { group?: unknown; value?: unknown }[]) {
      if (typeof o?.group === 'string' && typeof o.value === 'string')
        parts.push(`${o.group}: ${o.value}`);
    }
  }
  const text = (design as { design?: { text?: unknown } } | null)?.design?.text;
  if (typeof text === 'string' && text) parts.push(`“${text}”`);
  return parts.join(' · ');
}
