import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ReadyPieceDetail, ReadyPieceView } from '@forgea/types';
import type {
  AddReadyPiecesDto,
  CountReadyPiecesDto,
  TakeReadyPiecesDto,
} from '@forgea/validation';
import { ReadyPieceMovementKind } from '../generated/prisma/enums.js';
import {
  type ReadyPieceRow,
  ReadyPiecesRepository,
} from './ready-pieces.repository.js';

/**
 * Ready pieces: printed and not sold yet. They come from studio prints made to sell, a full
 * plate's spare pieces, orders cancelled after printing, and pieces added by hand (a custom
 * design kept); they leave when sold, given away or scrapped, and the shelf can be counted.
 */
@Injectable()
export class ReadyPiecesService {
  constructor(private readonly pieces: ReadyPiecesRepository) {}

  async list(all: boolean): Promise<ReadyPieceView[]> {
    return (await this.pieces.list(all)).map(toView);
  }

  async one(id: string): Promise<ReadyPieceDetail> {
    const p = await this.pieces.find(id);
    if (!p) throw new NotFoundException('Not found');
    return {
      ...toView(p),
      movements: p.movements.map((m) => ({
        id: m.id,
        kind: m.kind,
        quantity: m.quantity,
        unitCost: m.unitCost.toFixed(2),
        printJobId: m.printJobId,
        order: m.order ? { id: m.order.id, number: m.order.orderNumber } : null,
        note: m.note,
        by: m.createdBy ? (m.createdBy.name ?? m.createdBy.email) : null,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async add(dto: AddReadyPiecesDto, actorId: string): Promise<void> {
    const product = dto.productId
      ? await this.pieces.product(dto.productId)
      : null;
    if (dto.productId && !product)
      throw new NotFoundException('Product not found');
    const name = product?.name ?? dto.name;
    if (!name)
      throw new BadRequestException('Name the pieces, or choose a product');
    await this.pieces.transaction((tx) =>
      this.pieces.add(tx, {
        productId: product?.id ?? null,
        name,
        details: dto.details ?? '',
        kind: ReadyPieceMovementKind.ADDED,
        quantity: dto.quantity,
        unitCost: dto.unitCost,
        note: dto.note ?? null,
        createdById: actorId,
      }),
    );
  }

  async take(
    id: string,
    dto: TakeReadyPiecesDto,
    actorId: string,
  ): Promise<ReadyPieceDetail> {
    const order = dto.orderNumber
      ? await this.pieces.orderByNumber(dto.orderNumber)
      : null;
    if (dto.orderNumber && !order)
      throw new BadRequestException('No order has that number');
    await this.pieces.take({
      id,
      kind: dto.kind,
      quantity: dto.quantity,
      orderId: order?.id ?? null,
      note: dto.note ?? null,
      createdById: actorId,
    });
    return this.one(id);
  }

  async count(
    id: string,
    dto: CountReadyPiecesDto,
    actorId: string,
  ): Promise<ReadyPieceDetail> {
    await this.pieces.count({
      id,
      counted: dto.counted,
      note: dto.note ?? null,
      createdById: actorId,
    });
    return this.one(id);
  }
}

function toView(p: ReadyPieceRow): ReadyPieceView {
  return {
    id: p.id,
    product: p.product,
    name: p.name,
    details: p.details,
    onHand: p.onHand,
    unitCost: p.unitCost.toFixed(2),
    value: p.unitCost.times(p.onHand).toFixed(2),
    updatedAt: p.updatedAt.toISOString(),
  };
}
