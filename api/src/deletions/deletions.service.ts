import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { DeletionImpact, DeletionUse } from '@forgea/types';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';

/** The kinds of record the dashboard deletes. */
type DeletionKind =
  | 'product'
  | 'category'
  | 'material'
  | 'optionGroup'
  | 'optionValue'
  | 'stockItem'
  | 'printer'
  | 'lead'
  | 'lostReason'
  | 'leadStage';

/** What deleting one record means: what keeps it, what goes with it, what lets go of it. */
interface Plan {
  name: string;
  blockedBy: [number, string][];
  removes?: [number, string][];
  unlinks?: [number, string][];
  /** Said when it can't go. */
  instead: string;
  /** A rule of its own that keeps it (the pipeline's Won stage). */
  refusal?: string | undefined;
  run: () => Promise<unknown>;
}

const uses = (list: [number, string][] = []): DeletionUse[] =>
  list.filter(([n]) => n > 0).map(([count, what]) => ({ count, what }));

/**
 * Deletes a dashboard record only when nothing that must stay depends on it: orders, quotation
 * lines, stock movements, print runs, leads and products keep their history, so a record they
 * use is refused with what uses it and what to do instead (switch it off, hide it). What only
 * belongs to the record goes with it (a product's sizes, colours, options, print files and cart
 * lines; a lead's notes and activities), and `impact` says all of it before anything is deleted.
 * Orders, quotations and custom requests are never deleted (their status history is
 * append-only): they are cancelled. The database refuses the rest (foreign keys), so a link
 * this service doesn't know of still can't be broken.
 */
@Injectable()
export class DeletionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** What deleting it would do, without deleting anything. */
  async impact(kind: DeletionKind, id: string): Promise<DeletionImpact> {
    const plan = await this.plan(kind, id);
    const blockedBy = uses(plan.blockedBy);
    const deletable = blockedBy.length === 0 && !plan.refusal;
    return {
      id,
      name: plan.name,
      blockedBy,
      removes: uses(plan.removes),
      unlinks: uses(plan.unlinks),
      instead: deletable ? null : (plan.refusal ?? plan.instead),
      deletable,
    };
  }

  async delete(kind: DeletionKind, id: string): Promise<void> {
    const plan = await this.plan(kind, id);
    if (plan.refusal) throw new ConflictException(plan.refusal);
    const used = uses(plan.blockedBy);
    if (used.length > 0)
      throw new ConflictException(
        `It is used by ${used.map((u) => `${u.count} ${u.what}`).join(', ')}. ${plan.instead}`,
      );
    try {
      await plan.run();
    } catch (error) {
      // A link no check knew of is still refused by the database.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2003' || error.code === 'P2014')
      )
        throw new ConflictException(
          'Other records still use it, so it stays. Switch it off instead.',
        );
      throw error;
    }
  }

  private plan(kind: DeletionKind, id: string): Promise<Plan> {
    switch (kind) {
      case 'product':
        return this.product(id);
      case 'category':
        return this.category(id);
      case 'material':
        return this.material(id);
      case 'optionGroup':
        return this.optionGroup(id);
      case 'optionValue':
        return this.optionValue(id);
      case 'stockItem':
        return this.stockItem(id);
      case 'printer':
        return this.printer(id);
      case 'lead':
        return this.lead(id);
      case 'lostReason':
        return this.lostReason(id);
      case 'leadStage':
        return this.leadStage(id);
    }
  }

  private found<T>(row: T | null, what: string): T {
    if (!row) throw new NotFoundException(`${what} not found`);
    return row;
  }

  private async product(id: string): Promise<Plan> {
    const db = this.prisma;
    const row = this.found(
      await db.product.findUnique({ where: { id }, select: { name: true } }),
      'Product',
    );
    const where = { productId: id };
    return {
      name: row.name,
      blockedBy: [
        [await db.orderItem.count({ where }), 'order lines'],
        [await db.quotationLine.count({ where }), 'quotation lines'],
        [await db.stockMovement.count({ where }), 'stock movements'],
        [await db.readyPiece.count({ where }), 'ready pieces'],
      ],
      removes: [
        [await db.productSize.count({ where }), 'sizes'],
        [await db.productColour.count({ where }), 'colours'],
        [await db.productPrintFile.count({ where }), 'print files'],
        [await db.productOptionGroup.count({ where }), 'options offered'],
        [await db.cartItem.count({ where }), 'lines in shoppers’ carts'],
      ],
      instead:
        'Switch "Visible in the shop" off instead: it keeps its history.',
      run: () => db.product.delete({ where: { id } }),
    };
  }

  private async category(id: string): Promise<Plan> {
    const db = this.prisma;
    const row = this.found(
      await db.category.findUnique({ where: { id }, select: { name: true } }),
      'Category',
    );
    return {
      name: row.name,
      blockedBy: [
        [await db.product.count({ where: { categoryId: id } }), 'products'],
      ],
      instead: 'Move its products to another category first, or switch it off.',
      run: () => db.category.delete({ where: { id } }),
    };
  }

  private async material(id: string): Promise<Plan> {
    const db = this.prisma;
    const row = this.found(
      await db.material.findUnique({ where: { id }, select: { name: true } }),
      'Material',
    );
    const where = { materialId: id };
    return {
      name: row.name,
      blockedBy: [
        [await db.product.count({ where }), 'products'],
        [await db.optionValue.count({ where }), 'option choices'],
        [await db.stockItem.count({ where }), 'filaments'],
        [await db.customRequest.count({ where }), 'custom requests'],
      ],
      instead: 'Switch it off instead: it keeps its history.',
      run: () => db.material.delete({ where: { id } }),
    };
  }

  private async optionGroup(id: string): Promise<Plan> {
    const db = this.prisma;
    const row = this.found(
      await db.optionGroup.findUnique({
        where: { id },
        select: { name: true },
      }),
      'Option',
    );
    return {
      name: row.name,
      blockedBy: [
        [
          await db.productOptionGroup.count({ where: { groupId: id } }),
          'products offering it',
        ],
        [
          await db.product.count({
            where: {
              OR: [{ textColourGroupId: id }, { partColourGroupId: id }],
            },
          }),
          'products taking their colours from it',
        ],
      ],
      removes: [
        [await db.optionValue.count({ where: { groupId: id } }), 'choices'],
      ],
      instead: 'Take it off those products first, or switch it off.',
      run: () => db.optionGroup.delete({ where: { id } }),
    };
  }

  private async optionValue(id: string): Promise<Plan> {
    const db = this.prisma;
    const row = this.found(
      await db.optionValue.findUnique({
        where: { id },
        select: { label: true, group: { select: { name: true } } },
      }),
      'Choice',
    );
    return {
      name: `${row.group.name}: ${row.label}`,
      blockedBy: [
        [
          await db.productOptionValue.count({ where: { valueId: id } }),
          'products offering it',
        ],
      ],
      unlinks: [
        [
          await db.product.count({
            where: {
              OR: [
                { textDefaultColourId: id },
                { textDefaultBaseId: id },
                { textDefaultAccentId: id },
              ],
            },
          }),
          'products starting in it (they start in their first colour)',
        ],
      ],
      instead: 'Take it off those products first, or switch it off.',
      run: () => db.optionValue.delete({ where: { id } }),
    };
  }

  private async stockItem(id: string): Promise<Plan> {
    const db = this.prisma;
    const row = this.found(
      await db.stockItem.findUnique({
        where: { id },
        select: { colour: true, material: { select: { name: true } } },
      }),
      'Filament',
    );
    const where = { stockItemId: id };
    return {
      name: `${row.material.name} ${row.colour}`.trim(),
      blockedBy: [
        [await db.stockMovement.count({ where }), 'stock movements'],
        // Movements moved off it name it as where they were first.
        [
          await db.stockMovement.count({ where: { movedFromId: id } }),
          'stock movements moved off it',
        ],
        [await db.printJob.count({ where }), 'print runs'],
        [await db.orderItemFilament.count({ where }), 'order reels picked'],
      ],
      unlinks: [
        [
          await db.productColour.count({ where }),
          'product colours printed from it',
        ],
        [await db.optionValue.count({ where }), 'shop colours printed from it'],
      ],
      instead: 'Untick "Track this filament" instead: its movements stay.',
      run: () => db.stockItem.delete({ where: { id } }),
    };
  }

  private async printer(id: string): Promise<Plan> {
    const db = this.prisma;
    const row = this.found(
      await db.printer.findUnique({ where: { id }, select: { name: true } }),
      'Printer',
    );
    return {
      name: row.name,
      blockedBy: [
        [await db.printJob.count({ where: { printerId: id } }), 'print runs'],
      ],
      instead: 'Switch it off instead: its runs keep their costs.',
      run: () => db.printer.delete({ where: { id } }),
    };
  }

  /** A lead and its notes and activities; its quotations stay, without the lead. */
  private async lead(id: string): Promise<Plan> {
    const db = this.prisma;
    const row = this.found(
      await db.lead.findUnique({ where: { id }, select: { name: true } }),
      'Lead',
    );
    const where = { leadId: id };
    return {
      name: row.name,
      blockedBy: [],
      removes: [
        [await db.leadNote.count({ where }), 'notes'],
        [await db.leadActivity.count({ where }), 'activities'],
      ],
      unlinks: [
        [
          await db.quotation.count({ where }),
          'quotations (they stay, without the lead)',
        ],
      ],
      instead: '',
      run: () => db.lead.delete({ where: { id } }),
    };
  }

  private async lostReason(id: string): Promise<Plan> {
    const db = this.prisma;
    const row = this.found(
      await db.lostReason.findUnique({ where: { id }, select: { name: true } }),
      'Lost reason',
    );
    return {
      name: row.name,
      blockedBy: [
        [await db.lead.count({ where: { lostReasonId: id } }), 'leads'],
      ],
      instead: 'Switch it off instead.',
      run: () => db.lostReason.delete({ where: { id } }),
    };
  }

  private async leadStage(id: string): Promise<Plan> {
    const db = this.prisma;
    const stage = this.found(
      await db.leadStage.findUnique({
        where: { id },
        select: { name: true, isWon: true, isQuoted: true },
      }),
      'Stage',
    );
    return {
      name: stage.name,
      blockedBy: [[await db.lead.count({ where: { stageId: id } }), 'leads']],
      refusal:
        stage.isWon || stage.isQuoted
          ? 'The pipeline needs its Won and Quoted stages: rename it instead.'
          : undefined,
      instead: 'Move its leads to another stage first, or switch it off.',
      run: () => db.leadStage.delete({ where: { id } }),
    };
  }
}
