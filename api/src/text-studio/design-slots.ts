import { BadRequestException, Injectable } from '@nestjs/common';
import { estimatePrint } from '@forgea/pricing';
import type { DesignSlot, SlotChoice } from '@forgea/text3d';
import type { ProductSlotsOffer, SlotSummary } from '@forgea/types';
import type { DesignSlotDto, SlotChoiceDto } from '@forgea/validation';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { UploadsService } from '../uploads/uploads.service.js';
import { FontsRepository } from './fonts.repository.js';
import { LogosService } from './logos.service.js';
import { type FontRef, TextShaper } from './text-shaper.js';

/** What a product's slots need from it: their settings, its colours and its material. */
export interface SlotsProduct {
  designSlots: unknown;
  partColourGroup?: {
    values: { id: string; label: string; swatchHex: string | null }[];
  } | null;
  textColourGroup?: {
    values: { id: string; label: string; swatchHex: string | null }[];
  } | null;
  material: { densityGPerCm3: Prisma.Decimal; gramsPerHour: Prisma.Decimal };
}

/** A product's slots as chosen: what they add to it, and how they read. */
export interface MeasuredSlotsResult {
  /** The choices as they will be made (only editable slots keep a choice). */
  choices: Record<string, SlotChoice>;
  grams: string;
  printHours: string;
  /** Grams per colour (option value id), for stock. */
  colours: { id: string; grams: string }[];
  summary: SlotSummary[];
}

/**
 * One slot as an order keeps it: its settings and the choice made, so the order prints what
 * was bought however the product changes later.
 */
export interface OrderedSlot {
  slot: DesignSlot;
  choice: SlotChoice;
  summary: SlotSummary;
}

/** The slots as an order line keeps them (OrderItem.slots). */
export function orderedSlots(
  p: { designSlots: unknown },
  m: MeasuredSlotsResult | null,
): OrderedSlot[] | null {
  if (!m) return null;
  const slots = Array.isArray(p.designSlots)
    ? (p.designSlots as DesignSlot[])
    : [];
  return m.summary.flatMap((summary) => {
    const slot = slots.find((s) => s.id === summary.slotId);
    return slot ? [{ slot, choice: m.choices[slot.id] ?? {}, summary }] : [];
  });
}

/**
 * Text and logos added to any product's model (DesignSlot, @forgea/text3d): checked when the
 * owner saves them, offered to the product page, and measured in the worker when a customer
 * chooses, so the price, the cart and the order all count what is really printed.
 */
@Injectable()
export class DesignSlots {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fonts: FontsRepository,
    private readonly logos: LogosService,
    private readonly uploads: UploadsService,
    private readonly shaper: TextShaper,
  ) {}

  /** The product's slots, as saved. */
  of(p: Pick<SlotsProduct, 'designSlots'>): DesignSlot[] {
    return Array.isArray(p.designSlots) ? (p.designSlots as DesignSlot[]) : [];
  }

  /** The colours slots print in: the product's part colours, then its text colours. */
  colours(p: SlotsProduct): ProductSlotsOffer['colours'] {
    const seen = new Map<string, ProductSlotsOffer['colours'][number]>();
    for (const v of [
      ...(p.partColourGroup?.values ?? []),
      ...(p.textColourGroup?.values ?? []),
    ])
      if (!seen.has(v.id))
        seen.set(v.id, { id: v.id, label: v.label, swatchHex: v.swatchHex });
    return [...seen.values()];
  }

  /**
   * The owner's slots, checked before they are saved: ids once each, every font and logo one
   * that is offered, and every colour one of the product's colour choices.
   */
  async check(
    slots: readonly DesignSlotDto[],
    groupIds: readonly (string | undefined | null)[],
  ): Promise<DesignSlot[]> {
    if (slots.length === 0) return [];
    if (new Set(slots.map((s) => s.id)).size !== slots.length)
      throw new BadRequestException('Two text or logo places share one id');
    const groups = groupIds.filter((g): g is string => !!g);
    const colours = new Set(
      groups.length
        ? (
            await this.prisma.optionValue.findMany({
              where: { groupId: { in: groups }, active: true },
              select: { id: true },
            })
          ).map((v) => v.id)
        : [],
    );
    const fonts = new Set((await this.fonts.active()).map((f) => f.id));
    const logos = await this.logos.named(
      slots.flatMap((s) => (s.logoId ? [s.logoId] : [])),
    );
    return slots.map((s): DesignSlot => {
      if (!colours.has(s.colour))
        throw new BadRequestException(
          `${s.label}: choose its colour from the product's colours (pick the colours customers choose from first)`,
        );
      if (s.kind === 'TEXT') {
        if (!s.defaultFontId || !fonts.has(s.defaultFontId))
          throw new BadRequestException(`${s.label}: choose one of the fonts`);
      } else {
        const logo = s.logoId ? logos.get(s.logoId) : undefined;
        if (!logo || !logo.active)
          throw new BadRequestException(`${s.label}: choose one of the logos`);
      }
      return {
        id: s.id,
        kind: s.kind,
        label: s.label,
        editable: s.editable,
        placement: {
          origin: s.placement.origin,
          normal: s.placement.normal,
          up: s.placement.up,
        },
        heightMm: s.heightMm,
        maxWidthMm: s.maxWidthMm,
        depthMm: s.depthMm,
        colour: s.colour,
        ...(s.kind === 'TEXT'
          ? {
              defaultText: s.defaultText ?? '',
              ...(s.maxChars ? { maxChars: s.maxChars } : {}),
              defaultFontId: s.defaultFontId!,
            }
          : { logoId: s.logoId!, defaultOn: s.defaultOn ?? true }),
      };
    });
  }

  /** Logos a product offers (a keychain's): each one that exists and is switched on. */
  async checkLogos(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const named = await this.logos.named(ids);
    if (ids.some((id) => !named.get(id)?.active))
      throw new BadRequestException('Choose the logos from the ones offered');
  }

  /** What the product page needs for its slots; null without any. */
  async offer(p: SlotsProduct): Promise<ProductSlotsOffer | null> {
    const slots = this.of(p);
    if (slots.length === 0) return null;
    const hasText = slots.some((s) => s.kind === 'TEXT');
    return {
      slots,
      logos: (
        await this.logos.outlines(slots.flatMap((s) => s.logoId ?? []))
      ).map(([id, outline]) => ({ id, outline })),
      fonts: hasText
        ? (await this.fonts.active()).map((f) => ({
            id: f.id,
            name: f.name,
            fileKey: f.fileKey,
            latin: f.latin,
            arabic: f.arabic,
          }))
        : [],
      colours: this.colours(p),
    };
  }

  /**
   * The customer's choices checked (only editable slots, offered fonts and colours) and the
   * slots measured in the worker: the grams and hours they add, and how they read. 400 with
   * the customer's reason when they can't be made. None for a product without slots.
   */
  async measure(
    p: SlotsProduct,
    given: readonly SlotChoiceDto[],
  ): Promise<MeasuredSlotsResult | null> {
    const slots = this.of(p);
    if (slots.length === 0) return null;
    const choices = await this.choices(p, slots, given);
    const fonts = new Map((await this.fonts.all()).map((f) => [f.id, f]));
    const used = new Set(
      slots.flatMap((s) =>
        s.kind === 'TEXT'
          ? [choices[s.id]?.fontId ?? s.defaultFontId ?? '']
          : [],
      ),
    );
    const refs: FontRef[] = [...used].flatMap((id) => {
      const f = fonts.get(id);
      return f ? [{ id, read: () => this.uploads.read(f.fileKey) }] : [];
    });
    const logos = await this.logos.outlines(
      slots.flatMap((s) => s.logoId ?? []),
    );
    const measured = await this.shaper.measureSlots(
      refs,
      slots,
      choices,
      logos,
    );
    if (measured.problem !== null)
      throw new BadRequestException(measured.problem);

    const volume = measured.slots.reduce((n, s) => n + s.volumeMm3, 0);
    // Raised text and logos are thin: they print solid.
    const print =
      volume > 0
        ? estimatePrint({
            volumeMm3: volume.toFixed(3),
            densityGPerCm3: p.material.densityGPerCm3.toString(),
            solidityPercent: 100,
            gramsPerHour: p.material.gramsPerHour.toString(),
          })
        : { grams: '0', printHours: '0' };
    const share = (v: number) =>
      new Prisma.Decimal(print.grams).times(volume > 0 ? v / volume : 0);
    const byColour = new Map<string, Prisma.Decimal>();
    for (const s of measured.slots)
      byColour.set(
        s.colour,
        (byColour.get(s.colour) ?? new Prisma.Decimal(0)).plus(
          share(s.volumeMm3),
        ),
      );
    const colourNames = new Map(this.colours(p).map((c) => [c.id, c.label]));
    const logoNames = await this.logos.named(
      slots.flatMap((s) => s.logoId ?? []),
    );
    return {
      choices,
      grams: print.grams,
      printHours: print.printHours,
      colours: [...byColour].map(([id, g]) => ({ id, grams: g.toFixed(1) })),
      summary: measured.slots.map((m): SlotSummary => {
        const slot = slots.find((s) => s.id === m.slotId)!;
        const choice = choices[slot.id] ?? {};
        const text = (choice.text ?? slot.defaultText ?? '').trim();
        const fontId = choice.fontId ?? slot.defaultFontId;
        return {
          slotId: slot.id,
          label: slot.label,
          kind: slot.kind,
          text: slot.kind === 'TEXT' ? text : null,
          font:
            slot.kind === 'TEXT'
              ? (fonts.get(fontId ?? '')?.name ?? null)
              : null,
          logo:
            slot.kind === 'LOGO'
              ? (logoNames.get(slot.logoId ?? '')?.name ?? null)
              : null,
          colour: colourNames.get(m.colour) ?? '',
          grams: share(m.volumeMm3).toFixed(1),
        };
      }),
    };
  }

  /** The slots as print files for an order line: one STL per slot, in the model's frame. */
  async files(
    slots: DesignSlot[],
    choices: Record<string, SlotChoice>,
  ): Promise<{ slotId: string; colour: string; bytes: Uint8Array }[]> {
    // Every font, active or not: an order made with a font switched off since still prints.
    const fonts = new Map((await this.fonts.all()).map((f) => [f.id, f]));
    const refs: FontRef[] = [...fonts.values()]
      .filter((f) =>
        slots.some(
          (s) =>
            s.kind === 'TEXT' &&
            (choices[s.id]?.fontId ?? s.defaultFontId) === f.id,
        ),
      )
      .map((f) => ({ id: f.id, read: () => this.uploads.read(f.fileKey) }));
    const logos = await this.logos.outlines(
      slots.flatMap((s) => s.logoId ?? []),
    );
    const files = await this.shaper.slotFiles(refs, slots, choices, logos);
    if ('problem' in files) throw new BadRequestException(files.problem);
    return files;
  }

  /** Only editable slots take a choice; fonts and colours must be ones offered. */
  private async choices(
    p: SlotsProduct,
    slots: readonly DesignSlot[],
    given: readonly SlotChoiceDto[],
  ): Promise<Record<string, SlotChoice>> {
    const colours = new Set(this.colours(p).map((c) => c.id));
    const fonts = new Set((await this.fonts.active()).map((f) => f.id));
    const out: Record<string, SlotChoice> = {};
    for (const c of given) {
      const slot = slots.find((s) => s.id === c.slotId);
      if (!slot)
        throw new BadRequestException('This product changed: reload the page');
      if (!slot.editable) continue;
      if (c.fontId !== undefined && !fonts.has(c.fontId))
        throw new BadRequestException(
          `${slot.label}: choose one of the fonts offered`,
        );
      if (c.colour !== undefined && !colours.has(c.colour))
        throw new BadRequestException(
          `${slot.label}: choose one of the colours offered`,
        );
      out[slot.id] = {
        ...(c.text !== undefined && slot.kind === 'TEXT'
          ? { text: c.text.trim() }
          : {}),
        ...(c.fontId !== undefined && slot.kind === 'TEXT'
          ? { fontId: c.fontId }
          : {}),
        ...(c.on !== undefined && slot.kind === 'LOGO' ? { on: c.on } : {}),
        ...(c.colour !== undefined ? { colour: c.colour } : {}),
      };
    }
    return out;
  }
}
