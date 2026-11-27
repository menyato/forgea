import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Page,
  PieceCounts,
  PieceDetail,
  PieceHolderAccount,
  PieceView,
  PrintFile,
} from '@forgea/types';
import type {
  FinishPieceDto,
  PieceListQuery,
  StudioPrintDto,
  UpdatePieceDto,
} from '@forgea/validation';
import { toPage } from '../common/pagination/keyset.js';
import { studioDayStart } from '../common/studio-day.js';
import { PieceStage } from '../generated/prisma/enums.js';
import { StockService } from '../stock/stock.service.js';
import { isModelKey } from '../uploads/model-variants.js';
import {
  type PieceChange,
  type PieceDetailRow,
  type PieceRow,
  PiecesRepository,
} from './pieces.repository.js';

const accountOf = (
  u: { id: string; name: string | null; email: string } | null,
): PieceHolderAccount | null =>
  u ? { id: u.id, name: u.name, email: u.email } : null;

/**
 * The 3D model a piece shows: its product's, else what its order line sold (the line's product,
 * the 3MF it was printed from, its request's design or the customer's file). Null for pieces
 * made from free text with no file.
 */
function modelOf(p: PieceRow): string | null {
  const line = p.orderItem;
  const request = line?.order.customRequest;
  const file = line?.printFile as PrintFile | null | undefined;
  return (
    [
      p.product?.modelFileKey,
      line?.product?.modelFileKey,
      file?.fileKey,
      request?.designPreviewKey,
      request?.fileKey,
    ].find((k): k is string => !!k && isModelKey(k)) ?? null
  );
}

function toView(p: PieceRow): PieceView {
  return {
    id: p.id,
    name: p.name,
    productId: p.productId,
    modelKey: modelOf(p),
    orderNumber: p.orderItem?.order.orderNumber ?? null,
    quantity: p.quantity,
    stage: p.stage,
    holder: p.holder,
    holderAccount: accountOf(p.holderUser),
    note: p.note,
    printedAt: p.printedAt.toISOString(),
    grams: p.grams,
    cost: p.cost?.toFixed(2) ?? null,
  };
}

/** What a print still on the printer was started as (the studio print to record). */
function planOf(p: PieceDetailRow): StudioPrintDto | null {
  if (!p.plan || typeof p.plan !== 'object' || Array.isArray(p.plan))
    return null;
  return p.plan as unknown as StudioPrintDto;
}

/**
 * The "Where it is" board: every print (studio prints, failed prints, order lines' runs), when
 * it was printed and where it is now, moved by the team; each move is kept.
 */
@Injectable()
export class PiecesService {
  constructor(
    private readonly pieces: PiecesRepository,
    private readonly stock: StockService,
  ) {}

  async list(query: PieceListQuery): Promise<Page<PieceView>> {
    return toPage(await this.pieces.list(query), toView);
  }

  /** Who a piece can be linked to: everyone with an account (team and customers). */
  async accounts(): Promise<(PieceHolderAccount & { team: boolean })[]> {
    return (await this.pieces.accounts()).map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      team: u.role !== 'CUSTOMER',
    }));
  }

  async counts(query: PieceListQuery): Promise<PieceCounts> {
    const { stages: _stages, ...rest } = query;
    const c = await this.pieces.counts(rest);
    return { ...c, cost: c.cost.toFixed(2) };
  }

  async one(id: string): Promise<PieceDetail> {
    const p = await this.pieces.find(id);
    if (!p) throw new NotFoundException('Piece not found');
    const plan = planOf(p);
    return {
      ...toView(p),
      plan: plan
        ? {
            productId: plan.productId,
            quantity: plan.quantity,
            parts: (plan.parts ?? [])
              .map((x) => `${x.part}: ${x.colour}`)
              .concat(plan.colour ? [plan.colour] : [])
              .concat(plan.size ? [plan.size] : [])
              .join(' · '),
          }
        : null,
      moves: p.moves.map((m) => ({
        stage: m.stage,
        holder: m.holder,
        holderAccount: accountOf(m.holderUser),
        note: m.note,
        by: m.by ? (m.by.name ?? m.by.email) : null,
        at: m.at.toISOString(),
      })),
    };
  }

  /** Moves a piece (where it is, who has it) or corrects it (name, how many, printed on). */
  async update(
    id: string,
    dto: UpdatePieceDto,
    actorId: string,
  ): Promise<PieceDetail> {
    const p = await this.pieces.find(id);
    if (!p) throw new NotFoundException('Piece not found');
    if (p.stage === PieceStage.PRINTING && dto.stage !== undefined)
      throw new BadRequestException(
        'It is still printing: record it as done or failed first',
      );
    if (dto.holderId && !(await this.pieces.accountExists(dto.holderId)))
      throw new BadRequestException('Choose someone from the list');
    const change: PieceChange = {};
    if (dto.name !== undefined) change.name = dto.name;
    if (dto.quantity !== undefined) change.quantity = dto.quantity;
    if (dto.stage !== undefined) change.stage = dto.stage;
    if (dto.holder !== undefined) change.holder = dto.holder || null;
    if (dto.holderId !== undefined) change.holderId = dto.holderId;
    if (dto.note !== undefined) change.note = dto.note || null;
    if (dto.printedOn !== undefined)
      change.printedAt = studioDayStart(dto.printedOn);
    // Back in the lab or the shop: nobody holds it any more.
    const stage = change.stage ?? p.stage;
    if (
      change.stage !== undefined &&
      (stage === PieceStage.IN_LAB || stage === PieceStage.IN_SHOP) &&
      dto.holder === undefined &&
      dto.holderId === undefined
    ) {
      change.holder = null;
      change.holderId = null;
    }
    if (!(await this.pieces.change(id, p.updatedAt, change, actorId)))
      throw new ConflictException(
        'Someone else just changed this piece. Reload and try again.',
      );
    return this.one(id);
  }

  /** A print on the printer is done (its filament comes off the shelf now) or failed. */
  async finish(
    id: string,
    dto: FinishPieceDto,
    actorId: string,
  ): Promise<PieceDetail> {
    const p = await this.pieces.find(id);
    if (!p) throw new NotFoundException('Piece not found');
    const plan = planOf(p);
    if (p.stage !== PieceStage.PRINTING || !plan)
      throw new ConflictException('This piece is not printing');
    await this.stock.studioPrint(
      {
        ...plan,
        printing: false,
        ...(dto.failed && dto.progressPercent !== undefined
          ? { progressPercent: dto.progressPercent }
          : {}),
        ...(dto.note ? { note: dto.note } : {}),
      },
      dto.failed === true,
      actorId,
      { id, expected: p.updatedAt },
    );
    return this.one(id);
  }
}
