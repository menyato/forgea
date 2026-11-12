import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';

/** What a record is still used by: each a count and how to say it ("on 3 orders"). */
type Uses = readonly [number, string][];

/**
 * Deletes a dashboard record only when nothing that must stay depends on it: orders, quotation
 * lines, stock movements, print runs, leads and products keep their history, so a record they
 * use is refused with what uses it and what to do instead (switch it off, hide it). What only
 * belongs to the record goes with it (a product's sizes, colours, options, print files and cart
 * lines; a lead's notes and activities). Orders, quotations and custom requests are never
 * deleted (their status history is append-only): they are cancelled. The database refuses the rest (foreign keys), so a
 * link this service doesn't know of still can't be broken.
 */
@Injectable()
export class DeletionsService {
  constructor(private readonly prisma: PrismaService) {}

  async product(id: string): Promise<void> {
    await this.exists(this.prisma.product.count({ where: { id } }), 'Product');
    await this.refuseIfUsed(
      [
        [
          await this.prisma.orderItem.count({ where: { productId: id } }),
          'order lines',
        ],
        [
          await this.prisma.quotationLine.count({ where: { productId: id } }),
          'quotation lines',
        ],
        [
          await this.prisma.stockMovement.count({ where: { productId: id } }),
          'stock movements',
        ],
        [
          await this.prisma.readyPiece.count({ where: { productId: id } }),
          'ready pieces',
        ],
      ],
      'Switch "Visible in the shop" off instead: it keeps its history.',
    );
    await this.remove(() => this.prisma.product.delete({ where: { id } }));
  }

  async category(id: string): Promise<void> {
    await this.exists(
      this.prisma.category.count({ where: { id } }),
      'Category',
    );
    await this.refuseIfUsed(
      [
        [
          await this.prisma.product.count({ where: { categoryId: id } }),
          'products',
        ],
      ],
      'Move its products to another category first, or switch it off.',
    );
    await this.remove(() => this.prisma.category.delete({ where: { id } }));
  }

  async material(id: string): Promise<void> {
    await this.exists(
      this.prisma.material.count({ where: { id } }),
      'Material',
    );
    await this.refuseIfUsed(
      [
        [
          await this.prisma.product.count({ where: { materialId: id } }),
          'products',
        ],
        [
          await this.prisma.optionValue.count({ where: { materialId: id } }),
          'option choices',
        ],
        [
          await this.prisma.stockItem.count({ where: { materialId: id } }),
          'filament stock lines',
        ],
        [
          await this.prisma.customRequest.count({ where: { materialId: id } }),
          'custom requests',
        ],
      ],
      'Switch it off instead: it keeps its history.',
    );
    await this.remove(() => this.prisma.material.delete({ where: { id } }));
  }

  async optionGroup(id: string): Promise<void> {
    await this.exists(
      this.prisma.optionGroup.count({ where: { id } }),
      'Option',
    );
    await this.refuseIfUsed(
      [
        [
          await this.prisma.productOptionGroup.count({
            where: { groupId: id },
          }),
          'products offering it',
        ],
        [
          await this.prisma.product.count({
            where: {
              OR: [{ textColourGroupId: id }, { partColourGroupId: id }],
            },
          }),
          'products taking their colours from it',
        ],
      ],
      'Take it off those products first, or switch it off.',
    );
    await this.remove(() => this.prisma.optionGroup.delete({ where: { id } }));
  }

  async optionValue(id: string): Promise<void> {
    await this.exists(
      this.prisma.optionValue.count({ where: { id } }),
      'Choice',
    );
    await this.refuseIfUsed(
      [
        [
          await this.prisma.productOptionValue.count({
            where: { valueId: id },
          }),
          'products offering it',
        ],
        [
          await this.prisma.product.count({
            where: {
              OR: [
                { textDefaultColourId: id },
                { textDefaultBaseId: id },
                { textDefaultAccentId: id },
              ],
            },
          }),
          'products starting in it',
        ],
      ],
      'Take it off those products first, or switch it off.',
    );
    await this.remove(() => this.prisma.optionValue.delete({ where: { id } }));
  }

  async stockItem(id: string): Promise<void> {
    await this.exists(
      this.prisma.stockItem.count({ where: { id } }),
      'Filament',
    );
    await this.refuseIfUsed(
      [
        [
          await this.prisma.stockMovement.count({ where: { stockItemId: id } }),
          'stock movements',
        ],
        [
          await this.prisma.printJob.count({ where: { stockItemId: id } }),
          'print runs',
        ],
      ],
      'Untick "Track this filament" instead: its movements stay.',
    );
    await this.remove(() => this.prisma.stockItem.delete({ where: { id } }));
  }

  async printer(id: string): Promise<void> {
    await this.exists(this.prisma.printer.count({ where: { id } }), 'Printer');
    await this.refuseIfUsed(
      [
        [
          await this.prisma.printJob.count({ where: { printerId: id } }),
          'print runs',
        ],
      ],
      'Switch it off instead: its runs keep their costs.',
    );
    await this.remove(() => this.prisma.printer.delete({ where: { id } }));
  }

  /** A lead and its notes and activities; its quotations stay, without the lead. */
  async lead(id: string): Promise<void> {
    await this.exists(this.prisma.lead.count({ where: { id } }), 'Lead');
    await this.remove(() => this.prisma.lead.delete({ where: { id } }));
  }

  async lostReason(id: string): Promise<void> {
    await this.exists(
      this.prisma.lostReason.count({ where: { id } }),
      'Lost reason',
    );
    await this.refuseIfUsed(
      [
        [
          await this.prisma.lead.count({ where: { lostReasonId: id } }),
          'leads',
        ],
      ],
      'Switch it off instead.',
    );
    await this.remove(() => this.prisma.lostReason.delete({ where: { id } }));
  }

  async leadStage(id: string): Promise<void> {
    const stage = await this.prisma.leadStage.findUnique({
      where: { id },
      select: { isWon: true, isQuoted: true },
    });
    if (!stage) throw new NotFoundException('Stage not found');
    if (stage.isWon || stage.isQuoted)
      throw new ConflictException(
        'The pipeline needs its Won and Quoted stages: rename it instead.',
      );
    await this.refuseIfUsed(
      [[await this.prisma.lead.count({ where: { stageId: id } }), 'leads']],
      'Move its leads to another stage first, or switch it off.',
    );
    await this.remove(() => this.prisma.leadStage.delete({ where: { id } }));
  }

  private async exists(count: Promise<number>, what: string): Promise<void> {
    if ((await count) === 0) throw new NotFoundException(`${what} not found`);
  }

  private refuseIfUsed(uses: Uses, instead: string): void {
    const used = uses.filter(([n]) => n > 0);
    if (used.length === 0) return;
    throw new ConflictException(
      `It is used by ${used.map(([n, what]) => `${n} ${what}`).join(', ')}. ${instead}`,
    );
  }

  /** The delete itself; a link no check knew of is still refused by the database. */
  private async remove(run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
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
}
