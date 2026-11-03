import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { printProject } from './print-project.js';
import { TextStudio, type Measurement } from './text-studio.service.js';

/**
 * A personalised order line's print file in one colour: made again from the design as it was
 * ordered (the same fonts and settings), so it is exactly what the customer saw and bought.
 */
@Injectable()
export class PrintFiles {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studio: TextStudio,
  ) {}

  async stl(
    orderId: string,
    itemId: string,
    colour: string,
  ): Promise<{ name: string; bytes: Uint8Array }> {
    const { item, m } = await this.line(orderId, itemId);
    const wanted = m.colours.find((c) => c.label === colour);
    if (!wanted) throw new NotFoundException('No such print file');
    const files = await this.studio.printFiles(m.design, m.settings);
    const file = files.find((f) => f.colour === wanted.id);
    if (!file) throw new NotFoundException('No such print file');
    const slug = colour
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return {
      name: `${item.order.orderNumber}-${slug || 'part'}.stl`,
      bytes: file.bytes,
    };
  }

  /**
   * Every colour of an order line in one 3MF project: one object, a part per colour placed
   * as designed, each named and tinted after its filament, for the slicer.
   */
  async project(
    orderId: string,
    itemId: string,
  ): Promise<{ name: string; bytes: Uint8Array }> {
    const { item, m } = await this.line(orderId, itemId);
    const [files, values] = await Promise.all([
      this.studio.printFiles(m.design, m.settings),
      this.prisma.optionValue.findMany({
        where: { id: { in: m.colours.map((c) => c.id) } },
        select: { id: true, swatchHex: true },
      }),
    ]);
    const hex = new Map(values.map((v) => [v.id, v.swatchHex]));
    const parts = m.colours.flatMap((c) => {
      const file = files.find((f) => f.colour === c.id);
      return file
        ? [{ label: c.label, hex: hex.get(c.id) ?? null, stl: file.bytes }]
        : [];
    });
    if (parts.length === 0) throw new NotFoundException('No such print file');
    const number = item.order.orderNumber;
    return { name: `${number}.3mf`, bytes: printProject(number, parts) };
  }

  /** A personalised order line and the design it was ordered with. */
  private async line(orderId: string, itemId: string) {
    const item = await this.prisma.orderItem.findFirst({
      where: { id: itemId, orderId },
      select: { design: true, order: { select: { orderNumber: true } } },
    });
    const m = item?.design as Measurement | null | undefined;
    if (!item || !m) throw new NotFoundException('No such print file');
    return { item, m };
  }
}
