import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { ModelOptimizer } from '../uploads/model-optimizer.js';
import { UploadsService } from '../uploads/uploads.service.js';
import { DesignSlots, type OrderedSlot } from './design-slots.js';
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
    private readonly uploads: UploadsService,
    private readonly slots: DesignSlots,
    private readonly optimizer: ModelOptimizer,
  ) {}

  /**
   * An order line's print project with its text and logos as ordered: the product's print file
   * (or its model, when that is the slicer project) with each slot added to the part it lies on,
   * in the filament closest to its colour, so it opens ready to slice and print (print-ready.ts).
   * When the slots can't be placed that way, the model with the slots as one 3MF project, as
   * before. Made in the 3D worker; the slots are made again from what was ordered.
   */
  async slotsProject(
    orderId: string,
    itemId: string,
  ): Promise<{ name: string; bytes: Uint8Array }> {
    const item = await this.prisma.orderItem.findFirst({
      where: { id: itemId, orderId },
      select: {
        slots: true,
        options: true,
        order: { select: { orderNumber: true } },
        product: {
          select: {
            slug: true,
            modelFileKey: true,
            printFiles: {
              orderBy: { sortOrder: 'asc' },
              select: { fileKey: true },
            },
            // Parts customers recolour: a colour row named for its part, choices from this group
            colours: { select: { hex: true, part: true } },
            partColourGroup: {
              select: { values: { select: { label: true, swatchHex: true } } },
            },
          },
        },
      },
    });
    const ordered = (item?.slots as OrderedSlot[] | null | undefined) ?? [];
    const key = item?.product?.modelFileKey;
    if (!item || ordered.length === 0 || !key || !/\.(3mf|stl)$/.test(key))
      throw new NotFoundException('No such print file');
    const slots = ordered.map((o) => o.slot);
    const choices = Object.fromEntries(
      ordered.map((o) => [o.slot.id, o.choice]),
    );
    const [files, values] = await Promise.all([
      this.slots.files(slots, choices),
      this.prisma.optionValue.findMany({
        where: {
          id: {
            in: slots.flatMap((s) => [
              choices[s.id]?.colour ?? s.colour,
              ...(choices[s.id]?.logoColours ?? []),
            ]),
          },
        },
        select: { id: true, swatchHex: true, label: true },
      }),
    ]);
    const hex = new Map(values.map((v) => [v.id, v.swatchHex]));
    const named = new Map(values.map((v) => [v.id, v.label]));
    const number = item.order.orderNumber;
    const slug = item.product?.slug ?? 'print';
    const extras = files.map((f) => {
      const s = ordered.find((o) => o.slot.id === f.slotId)!;
      return {
        label: `${s.summary.label}: ${s.summary.text ?? s.summary.logo ?? ''} (${named.get(f.colour) ?? s.summary.colour})`,
        hex: hex.get(f.colour) ?? null,
        stl: f.bytes,
      };
    });
    // The parts recoloured on the order ("Base: White"): their file colour -> the chosen swatch.
    const chosen =
      (item.options as { group?: string; value?: string }[] | null) ?? [];
    const recolours = (item.product?.colours ?? []).flatMap((c) => {
      if (!c.part) return [];
      const label = chosen.find((o) => o.group === c.part)?.value;
      const to = item.product?.partColourGroup?.values.find(
        (v) => v.label === label,
      )?.swatchHex;
      return to ? [{ from: c.hex, to }] : [];
    });
    // Ready to print: the print file with the text on its parts (the model's frames place it),
    // or the model itself when it is the slicer project.
    if (key.endsWith('.3mf')) {
      const prints = item.product?.printFiles ?? [];
      const projects = prints.length
        ? prints.map((p) => p.fileKey).filter((k) => k.endsWith('.3mf'))
        : [key];
      for (const project of projects) {
        const ready = await this.optimizer.printReady(
          () => this.uploads.read(project),
          prints.length ? () => this.uploads.read(key) : null,
          extras,
          recolours,
        );
        if (ready) return { name: `${number}-${slug}.3mf`, bytes: ready };
      }
    }
    const bytes = await this.optimizer.project(
      () => this.uploads.read(key),
      key.slice(key.lastIndexOf('.') + 1),
      number,
      extras,
    );
    return { name: `${number}-${slug}-with-text.3mf`, bytes };
  }

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
    const own = await this.productProject(orderId, itemId);
    if (own) return own;
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

  /**
   * A line made from a 3MF (a quotation line, a custom request), or a catalog line whose
   * product has one: that file as it was uploaded (its colours, plates and slicer settings),
   * named after the order. Null for any other line.
   */
  private async productProject(
    orderId: string,
    itemId: string,
  ): Promise<{ name: string; bytes: Uint8Array } | null> {
    const item = await this.prisma.orderItem.findFirst({
      where: { id: itemId, orderId, design: { equals: Prisma.DbNull } },
      select: {
        printFile: true,
        order: { select: { orderNumber: true } },
        product: { select: { slug: true, modelFileKey: true } },
      },
    });
    if (!item) return null;
    const own = (item.printFile as { fileKey?: unknown } | null)?.fileKey;
    const key =
      typeof own === 'string' ? own : (item.product?.modelFileKey ?? null);
    if (!key || !/\.(3mf|stl|glb)$/.test(key)) return null;
    if (typeof own !== 'string' && !key.endsWith('.3mf')) return null;
    const extension = key.slice(key.lastIndexOf('.'));
    const name = item.product?.slug ?? 'print';
    return {
      name: `${item.order.orderNumber}-${name}${extension}`,
      bytes: await this.uploads.read(key),
    };
  }

  /**
   * One of the sliced print files of an order line's product (a product shown assembled and
   * printed from other files), as it was uploaded.
   */
  async productPrintFile(
    orderId: string,
    itemId: string,
    fileId: string,
  ): Promise<{ name: string; bytes: Uint8Array }> {
    const file = await this.prisma.productPrintFile.findFirst({
      where: {
        id: fileId,
        product: { orderItems: { some: { id: itemId, orderId } } },
      },
      select: {
        fileKey: true,
        name: true,
        product: {
          select: {
            orderItems: {
              where: { id: itemId },
              select: { order: { select: { orderNumber: true } } },
            },
          },
        },
      },
    });
    const number = file?.product.orderItems[0]?.order.orderNumber;
    if (!file || !number) throw new NotFoundException('No such print file');
    const slug = file.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return {
      name: `${number}-${slug || 'print'}.gcode.3mf`,
      bytes: await this.uploads.read(file.fileKey),
    };
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
