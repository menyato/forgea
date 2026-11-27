import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { OrderFilaments, PrintFile } from '@forgea/types';
import type { SaveOrderFilamentsDto } from '@forgea/validation';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  OrderStatus,
  PrintJobStatus,
  StockMovementKind,
} from '../generated/prisma/enums.js';
import {
  type ReelMovement,
  StockRepository,
} from '../stock/stock.repository.js';

/** Reels may be picked or changed until the order is printed (it goes to Ready). */
const EDITABLE: readonly OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.AWAITING_DEPOSIT,
  OrderStatus.CONFIRMED,
  OrderStatus.IN_PRODUCTION,
];

/** Comparable names: "PLA Matte" → "PLAMATTE". */
const plain = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Whether a reel of this material may print a colour the file was sliced for `type` in: the
 * same filament family (PLA for PLA or PLA Matte, never PETG). A file that doesn't say fits any.
 */
export function sameFilament(
  type: string | null | undefined,
  material: { code: string; name: string },
): boolean {
  if (!type) return true;
  const t = plain(type);
  return [material.code, material.name].some((m) => {
    const p = plain(m);
    return p !== '' && (p.startsWith(t) || t.startsWith(p));
  });
}

/**
 * The reels an order's 3MF lines print from: each colour of the file, picked by the team from
 * the shelf before the order goes into production (it can't without one per colour). Picked
 * after the stock was taken, the difference moves to the new reels as stock movements (what
 * the line took from each reel then matches the picks), and the line's unfinished print runs
 * follow.
 */
@Injectable()
export class OrderFilamentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockRepository,
  ) {}

  async get(orderId: string): Promise<OrderFilaments> {
    const order = await this.load(this.prisma, orderId);
    const reels = await this.prisma.stockItem.findMany({
      where: { active: true },
      select: {
        id: true,
        colour: true,
        materialId: true,
        material: { select: { code: true, name: true } },
      },
    });
    const lines = order.items.map((item) => {
      const file = item.printFile as unknown as PrintFile;
      return {
        orderItemId: item.id,
        name: item.name,
        quantity: item.quantity,
        colours: file.colours.map((c) => {
          const type = c.type ?? null;
          const fits = reels.filter((r) => sameFilament(type, r.material));
          const same = (r: (typeof reels)[number]) =>
            plain(r.colour) === plain(c.colour);
          const suggested =
            fits.find((r) => same(r) && r.materialId === file.materialId) ??
            (type ? fits.find(same) : undefined) ??
            null;
          return {
            colour: c.colour,
            hex: c.hex,
            grams: new Prisma.Decimal(c.grams).times(item.quantity).toFixed(2),
            type,
            stockItemId:
              item.filaments.find((f) => f.colour === c.colour)?.stockItemId ??
              null,
            suggestedId: suggested?.id ?? null,
          };
        }),
      };
    });
    return {
      editable: EDITABLE.includes(order.status),
      complete: lines.every((l) => l.colours.every((c) => c.stockItemId)),
      lines,
    };
  }

  /** Refuses going into production while a 3MF line's colour has no reel. */
  async requireComplete(orderId: string): Promise<void> {
    const { lines } = await this.get(orderId);
    for (const line of lines) {
      const missing = line.colours.filter((c) => !c.stockItemId);
      if (missing.length)
        throw new BadRequestException(
          `Pick the reel for ${missing.map((c) => c.colour).join(', ')} of "${line.name}" first (Filaments, on the order)`,
        );
    }
  }

  async save(
    orderId: string,
    dto: SaveOrderFilamentsDto,
    actorId: string,
  ): Promise<OrderFilaments> {
    await this.prisma.$transaction(async (tx) => {
      // One change to an order's reels at a time (each moves stock).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`filaments:${orderId}`}))`;
      const order = await this.load(tx, orderId);
      if (!EDITABLE.includes(order.status))
        throw new ConflictException(
          'This order is printed: its reels can no longer change',
        );
      for (const line of dto.lines) {
        const item = order.items.find((i) => i.id === line.orderItemId);
        if (!item)
          throw new BadRequestException(
            'That line is not one of this order’s 3MF lines',
          );
        const file = item.printFile as unknown as PrintFile;
        for (const picked of line.colours) {
          const colour = file.colours.find((c) => c.colour === picked.colour);
          if (!colour)
            throw new BadRequestException(
              `"${item.name}" has no colour ${picked.colour}`,
            );
          const reel = await tx.stockItem.findFirst({
            where: { id: picked.stockItemId, active: true },
            select: {
              colour: true,
              material: { select: { code: true, name: true } },
            },
          });
          if (!reel)
            throw new BadRequestException('Pick a reel that is in use');
          if (!sameFilament(colour.type, reel.material))
            throw new BadRequestException(
              `${picked.colour} is sliced for ${colour.type}: pick a ${colour.type} reel, not ${reel.material.name}`,
            );
          await tx.orderItemFilament.upsert({
            where: {
              orderItemId_colour: {
                orderItemId: item.id,
                colour: picked.colour,
              },
            },
            create: {
              orderItemId: item.id,
              colour: picked.colour,
              stockItemId: picked.stockItemId,
            },
            update: { stockItemId: picked.stockItemId },
          });
        }
        await this.follow(tx, order.orderNumber, item.id, actorId);
      }
    });
    return this.get(orderId);
  }

  /**
   * A line whose every colour has a reel: its unfinished print runs print from its main reel,
   * and once its stock was taken (it went into production) its takes are made again from the
   * picks, so a filament the shop once took from by mistake is left with nothing and can be
   * deleted.
   */
  private async follow(
    tx: Prisma.TransactionClient,
    orderNumber: string,
    orderItemId: string,
    actorId: string,
  ): Promise<void> {
    const item = await tx.orderItem.findUniqueOrThrow({
      where: { id: orderItemId },
      select: {
        quantity: true,
        printFile: true,
        filaments: {
          select: {
            colour: true,
            stockItemId: true,
            stockItem: {
              select: {
                colour: true,
                pricePerGram: true,
                material: { select: { code: true, pricePerGram: true } },
              },
            },
          },
        },
        stockMovements: {
          where: { kind: StockMovementKind.ORDER },
          select: { id: true },
        },
      },
    });
    const file = item.printFile as unknown as PrintFile;
    const picks = new Map(item.filaments.map((f) => [f.colour, f]));
    if (!file.colours.every((c) => picks.has(c.colour))) return;
    // What the picks take from each reel, in whole grams as production takes them.
    const wanted = new Map<string, number>();
    let main: { id: string; grams: number } | null = null;
    for (const c of file.colours) {
      const grams = new Prisma.Decimal(c.grams)
        .times(item.quantity)
        .ceil()
        .toNumber();
      const reel = picks.get(c.colour)!.stockItemId;
      wanted.set(reel, (wanted.get(reel) ?? 0) + grams);
      if (!main || grams > main.grams) main = { id: reel, grams };
    }
    // Print runs not finished print from the reel that gives most.
    if (main)
      await tx.printJob.updateMany({
        where: {
          orderItemId,
          status: {
            in: [
              PrintJobStatus.QUEUED,
              PrintJobStatus.SCHEDULED,
              PrintJobStatus.PRINTING,
            ],
          },
        },
        data: { stockItemId: main.id },
      });
    if (item.stockMovements.length === 0) return; // not taken yet: production takes it
    // Taken already: the line's takes are made again from the picks (the database lets this
    // transaction remove that line's own takes, nothing else), one per reel as production takes.
    const reels = new Map(item.filaments.map((f) => [f.stockItemId, f]));
    await tx.$executeRaw`SELECT set_config('forgea.repointing', 'order-filaments', true)`;
    await tx.stockMovement.deleteMany({
      where: { orderItemId, kind: StockMovementKind.ORDER },
    });
    await this.stock.recordOnReels(
      tx,
      [...wanted].map(([reel, grams]): ReelMovement => {
        const f = reels.get(reel)!;
        return {
          stockItemId: reel,
          kind: StockMovementKind.ORDER,
          grams: -grams,
          orderItemId,
          costPerGram:
            f.stockItem.pricePerGram ?? f.stockItem.material.pricePerGram,
          note: `Order ${orderNumber}`,
          createdById: actorId,
        };
      }),
    );
  }

  private async load(
    db: Prisma.TransactionClient | PrismaService,
    orderId: string,
  ) {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        orderNumber: true,
        status: true,
        items: {
          where: { printFile: { not: Prisma.DbNull } },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            name: true,
            quantity: true,
            printFile: true,
            filaments: { select: { colour: true, stockItemId: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }
}
