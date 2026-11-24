import { createHash } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  configuredUnitPrice,
  estimatePrint,
  type UnitCostCalculator,
} from '@forgea/pricing';
import {
  ACCENT_STYLES,
  BOARD_MOTIF_LABELS,
  BOARD_STYLES,
  type BoardItem,
  COUPLE_JOIN,
  coupleNames,
  KEYCHAIN_SHAPE_LABELS,
  type KeychainShape,
  lettersOf,
  PER_LETTER_STYLES,
  STANDING_STYLES,
  SUBTITLE_STYLES,
  subtitleProblem,
  TEXT_DECOR_LABELS,
  TEXT_DECORS,
  type TextSettings,
} from '@forgea/text3d/design';
import type {
  DesignMeasurement,
  DesignSummary,
  ProductTextOffer,
  ProductTextSettings,
  TextDesignInput,
} from '@forgea/types';
import { Prisma } from '../generated/prisma/client.js';
import { UploadPurpose, UploadStatus } from '../generated/prisma/enums.js';
import type { ConfigurableProduct } from '../products/product-configurator.js';
import {
  profitOf,
  withPriceOverride,
} from '../products/product-configurator.js';
import { StoreSettingsService } from '../store-settings/store-settings.service.js';
import { UploadsService } from '../uploads/uploads.service.js';
import { FontsRepository } from './fonts.repository.js';
import { sampleGlb } from './sample-glb.js';
import { type Measured, TextShaper } from './text-shaper.js';
import { LogosService, type StoredLogo } from './logos.service.js';

/**
 * A personalised piece as measured: what it takes to print (server-only: grams and hours are
 * cost), how it reads, and the design and settings it was made from. Kept with a cart line
 * and, at checkout, with the order line.
 */
export interface Measurement {
  design: TextDesignInput;
  settings: TextSettings;
  grams: string;
  printHours: string;
  /** Each colour's share of the grams (a multi-colour print takes from each reel). */
  colours: { id: string; label: string; grams: string }[];
  summary: DesignSummary;
}

/**
 * Personalised products: the settings their pieces are made with, what a customer may
 * design (the product's colours, the shop's fonts), and what a design costs. The pieces
 * themselves are made by @forgea/text3d in a worker (TextShaper).
 */
@Injectable()
export class TextStudio {
  constructor(
    private readonly fonts: FontsRepository,
    private readonly uploads: UploadsService,
    private readonly shaper: TextShaper,
    private readonly store: StoreSettingsService,
    private readonly logos: LogosService,
  ) {}

  /** The product's settings as the dashboard edits them; null for a regular product. */
  settingsView(p: ConfigurableProduct): ProductTextSettings | null {
    const s = this.settings(p);
    if (!s || !p.textColourGroupId) return null;
    return {
      style: s.style,
      maxChars: s.maxChars,
      letterHeightMm: p.textHeightMm!.toString(),
      letterDepthMm: p.textDepthMm!.toString(),
      baseDepthMm: p.textBaseMm!.toString(),
      maxWidthMm: p.textMaxWidthMm!.toString(),
      colourGroupId: p.textColourGroupId,
      extraColourPrice: p.textExtraColourPrice.toFixed(2),
      sizesMm: p.textSizesMm.map((d) => d.toString()),
      defaultColourId: p.textDefaultColourId,
      defaultBaseColourId: p.textDefaultBaseId,
      defaultAccentColourId: ACCENT_STYLES.includes(s.style)
        ? p.textDefaultAccentId
        : null,
      decor: p.textDecor,
      shapes: p.textShapes as KeychainShape[],
      logoIds: p.textLogoIds,
      ownLogo: p.textOwnLogo,
    };
  }

  /** What the product page offers to design with; null for a regular product. */
  async offer(p: ConfigurableProduct): Promise<ProductTextOffer | null> {
    const view = this.settingsView(p);
    if (!view) return null;
    const { colourGroupId: _, ...rest } = view;
    return {
      ...rest,
      colours: (p.textColourGroup?.values ?? []).map((v) => ({
        id: v.id,
        label: v.label,
        swatchHex: v.swatchHex,
      })),
      logos: await this.offeredLogos(p),
      fonts: (await this.fonts.active()).map((f) => ({
        id: f.id,
        name: f.name,
        fileKey: f.fileKey,
        latin: f.latin,
        arabic: f.arabic,
      })),
    };
  }

  /**
   * Checks the design against the product (its fonts and colours) and measures it: the grams
   * and hours it takes, and how it reads. 400 with the customer's reason when it can't be made.
   *
   * `given` is the browser's own measurement (it built the same design for the preview): the
   * live price and the cart use it, so a busy shop costs the server no geometry. Without it
   * (checkout) the worker builds the design, and that is what an order is priced from.
   */
  async measure(
    p: ConfigurableProduct,
    design: TextDesignInput,
    given?: DesignMeasurement,
  ): Promise<Measurement> {
    const base = this.settings(p);
    if (!base) {
      throw new BadRequestException('This product has no text to design');
    }
    // The size: one of the letter heights the product offers (its own when none is chosen).
    const height =
      design.heightMm === undefined
        ? base.letterHeightMm
        : Number(design.heightMm);
    const offered = [base.letterHeightMm, ...p.textSizesMm.map(Number)];
    if (!offered.includes(height))
      throw new BadRequestException('Choose one of the sizes offered');
    const settings: TextSettings = {
      ...base,
      letterHeightMm: height,
      // A bigger size may be wider in proportion.
      maxWidthMm: (base.maxWidthMm * height) / base.letterHeightMm,
    };
    const colours = new Map(
      (p.textColourGroup?.values ?? []).map((v) => [v.id, v.label]),
    );
    const fonts = new Map((await this.fonts.active()).map((f) => [f.id, f]));
    const perLetter = PER_LETTER_STYLES.includes(settings.style);
    const accented = ACCENT_STYLES.includes(settings.style);
    const initial = settings.style === 'INITIAL_NAME';
    const initialFont = initial ? design.accentFontId : undefined;
    // A big initial's own decorations and their colour; a line under the name where it fits.
    const decor = initial ? design.decor : undefined;
    if (decor && !TEXT_DECORS.includes(decor))
      throw new BadRequestException('Choose the decorations');
    const decorColour = initial ? design.decorColour : undefined;
    const subtitle = SUBTITLE_STYLES.includes(settings.style)
      ? design.subtitle?.trim() || undefined
      : undefined;
    const subtitleIssue = subtitleProblem(subtitle);
    if (subtitleIssue) throw new BadRequestException(subtitleIssue);
    const letters = perLetter
      ? lettersOf(design.text).map((_, i) => design.letters?.[i] ?? {})
      : [];
    // Only what is offered: the product's colours, the shop's active fonts.
    for (const c of [
      design.textColour,
      design.baseColour,
      accented ? design.accentColour : undefined,
      decorColour,
      ...letters.map((l) => l.colour),
    ]) {
      if (c !== undefined && !colours.has(c))
        throw new BadRequestException('Choose one of the colours offered');
    }
    for (const id of [
      design.fontId,
      initialFont,
      ...letters.map((l) => l.fontId),
    ]) {
      if (id !== undefined && !fonts.has(id))
        throw new BadRequestException('Choose one of the fonts offered');
    }
    // A board piece's items: the product's colours and fonts, its logos or the customer's own.
    const board = BOARD_STYLES.includes(settings.style);
    const offeredLogos =
      board || settings.style === 'KEYCHAIN' ? await this.offeredLogos(p) : [];
    const items: BoardItem[] = [];
    const itemLogos = new Map<
      string,
      StoredLogo & { id: string; name: string }
    >();
    for (const item of board ? (design.items ?? []) : []) {
      if (!colours.has(item.colour))
        throw new BadRequestException('Choose one of the colours offered');
      const kept = {
        id: item.id,
        kind: item.kind,
        x: item.x,
        y: item.y,
        size: item.size,
        rotation: item.rotation,
        colour: item.colour,
      };
      if (item.kind === 'TEXT') {
        if (item.fontId !== undefined && !fonts.has(item.fontId))
          throw new BadRequestException('Choose one of the fonts offered');
        items.push({
          ...kept,
          text: (item.text ?? '').trim(),
          ...(item.fontId && item.fontId !== design.fontId
            ? { fontId: item.fontId }
            : {}),
        });
      } else if (item.kind === 'MOTIF') {
        items.push({ ...kept, ...(item.motif ? { motif: item.motif } : {}) });
      } else {
        const id = item.logoId;
        const logo = id
          ? (itemLogos.get(id) ??
            offeredLogos.find((l) => l.id === id) ??
            (p.textOwnLogo ? await this.customerLogo(id) : undefined))
          : undefined;
        if (!logo)
          throw new BadRequestException('Choose one of the logos offered');
        itemLogos.set(logo.id, logo);
        items.push({ ...kept, logoId: logo.id });
      }
    }
    // A keychain's shape and logo: only ones the product offers.
    const keychain = settings.style === 'KEYCHAIN';
    const shape =
      keychain && design.shape && design.shape !== 'OUTLINE'
        ? design.shape
        : undefined;
    if (shape && !p.textShapes.includes(shape))
      throw new BadRequestException('Choose one of the shapes offered');
    const logos = keychain ? offeredLogos : [];
    // One the product offers, or the customer's own where the product lets them bring one.
    const logo =
      keychain && design.logoId
        ? (logos.find((l) => l.id === design.logoId) ??
          (p.textOwnLogo ? await this.customerLogo(design.logoId) : undefined))
        : undefined;
    if (keychain && design.logoId && !logo)
      throw new BadRequestException('Choose one of the logos offered');
    // A logo in its colours: one offered colour for each of its own, or none (one colour).
    const logoColours =
      logo?.inks && design.logoColours?.length === logo.inks.length
        ? design.logoColours
        : undefined;
    if (design.logoColours?.length && !logoColours)
      throw new BadRequestException(
        "Choose a colour for each of the logo's colours",
      );
    for (const c of logoColours ?? [])
      if (!colours.has(c))
        throw new BadRequestException('Choose one of the colours offered');
    // As made: letters only where they apply, a backing colour only when it differs.
    const clean: TextDesignInput = {
      // A couple's names always joined the same way ("Sara & Ali").
      text:
        settings.style === 'COUPLE'
          ? coupleNames(design.text).join(COUPLE_JOIN)
          : design.text.trim(),
      fontId: design.fontId,
      textColour: design.textColour,
      ...(design.baseColour && design.baseColour !== design.textColour
        ? { baseColour: design.baseColour }
        : {}),
      ...(accented &&
      design.accentColour &&
      design.accentColour !== design.textColour
        ? { accentColour: design.accentColour }
        : {}),
      ...(initialFont && initialFont !== design.fontId
        ? { accentFontId: initialFont }
        : {}),
      ...(decor && decor !== base.decor ? { decor } : {}),
      ...(decorColour &&
      decorColour !== (design.accentColour ?? design.textColour)
        ? { decorColour }
        : {}),
      ...(subtitle ? { subtitle } : {}),
      ...(height !== base.letterHeightMm ? { heightMm: String(height) } : {}),
      ...(perLetter ? { letters } : {}),
      ...(shape ? { shape } : {}),
      ...(logo ? { logoId: logo.id } : {}),
      ...(logoColours ? { logoColours } : {}),
      ...(board ? { items } : {}),
    };
    const used = new Set([
      clean.fontId,
      ...(clean.accentFontId ? [clean.accentFontId] : []),
      ...letters.flatMap((l) => l.fontId ?? []),
      ...items.flatMap((i) => i.fontId ?? []),
    ]);
    const shapes: [string, StoredLogo][] = [
      ...(logo ? [[logo.id, logo] as [string, StoredLogo]] : []),
      ...[...itemLogos.values()].map((l) => [l.id, l] as [string, StoredLogo]),
    ];
    const measured = given
      ? plausible(given, clean, settings, perLetter ? letters : [])
      : await this.shaper.measure(
          [...used].map((id) => ({
            id,
            read: () => this.uploads.read(fonts.get(id)!.fileKey),
          })),
          clean,
          settings,
          shapes,
        );
    if (measured.problem !== null)
      throw new BadRequestException(measured.problem);

    const volume = measured.parts.reduce((s, x) => s + x.volumeMm3, 0);
    const { requests } = await this.store.get();
    const print = estimatePrint({
      volumeMm3: volume.toFixed(3),
      densityGPerCm3: p.material.densityGPerCm3.toString(),
      solidityPercent: requests.estimateSolidityPercent,
      gramsPerHour: p.material.gramsPerHour.toString(),
    });
    const byColour = new Map<string, number>();
    for (const part of measured.parts)
      byColour.set(
        part.colour,
        (byColour.get(part.colour) ?? 0) + part.volumeMm3,
      );
    const font = (id: string | undefined) =>
      fonts.get(id ?? clean.fontId)!.name;
    return {
      design: clean,
      settings,
      grams: print.grams,
      printHours: print.printHours,
      colours: [...byColour].map(([id, v]) => ({
        id,
        label: colours.get(id)!,
        grams: new Prisma.Decimal(print.grams)
          .times(volume > 0 ? v / volume : 0)
          .toFixed(1),
      })),
      summary: {
        style: settings.style,
        text: clean.text,
        font: font(clean.fontId),
        textColour: colours.get(clean.textColour)!,
        baseColour: clean.baseColour ? colours.get(clean.baseColour)! : null,
        accentColour: clean.accentColour
          ? colours.get(clean.accentColour)!
          : null,
        accentFont: clean.accentFontId ? font(clean.accentFontId) : null,
        decor: initial
          ? TEXT_DECOR_LABELS[clean.decor ?? base.decor ?? 'HEARTS']
          : null,
        decorColour: clean.decorColour ? colours.get(clean.decorColour)! : null,
        subtitle: clean.subtitle ?? null,
        letters: perLetter
          ? lettersOf(clean.text).map((char, i) => ({
              char,
              font: font(letters[i]?.fontId),
              colour: colours.get(letters[i]?.colour ?? clean.textColour)!,
            }))
          : null,
        letterHeightMm: height,
        shape: shape ? KEYCHAIN_SHAPE_LABELS[shape] : null,
        logo: logo?.name ?? null,
        logoColours: logoColours?.map((c) => colours.get(c)!) ?? null,
        items: board
          ? items.map((i) => ({
              kind: i.kind,
              label:
                i.kind === 'TEXT'
                  ? `${i.text} (${font(i.fontId)})`
                  : i.kind === 'MOTIF'
                    ? BOARD_MOTIF_LABELS[i.motif!]
                    : itemLogos.get(i.logoId!)!.name,
              colour: colours.get(i.colour)!,
            }))
          : null,
        sizeMm: {
          x: round1(measured.size.x),
          y: round1(measured.size.y),
          z: round1(measured.size.z),
        },
      },
    };
  }

  /** A customer's own logo, named for the order, with its outline. */
  private async customerLogo(
    id: string,
  ): Promise<(StoredLogo & { id: string; name: string }) | undefined> {
    if (!(await this.logos.customerLogoIds([id])).has(id)) return undefined;
    const [found] = await this.logos.outlines([id]);
    return found ? { id, name: 'Your logo', ...found[1] } : undefined;
  }

  /** The logos a keychain product offers (switched-off ones dropped), with their outlines. */
  /** The studio logos a keychain or a board piece offers, with their outlines. */
  private async offeredLogos(
    p: ConfigurableProduct,
  ): Promise<(StoredLogo & { id: string; name: string })[]> {
    const offers =
      p.textStyle === 'KEYCHAIN' ||
      (p.textStyle !== null && BOARD_STYLES.includes(p.textStyle));
    if (!offers || p.textLogoIds.length === 0) return [];
    const named = await this.logos.named(p.textLogoIds);
    const outlines = new Map(await this.logos.outlines(p.textLogoIds));
    return p.textLogoIds.flatMap((id) => {
      const logo = named.get(id);
      const shape = outlines.get(id);
      return logo?.active && shape ? [{ id, name: logo.name, ...shape }] : [];
    });
  }

  /**
   * The piece's unit price: its grams and hours through the pricing engine (the product's
   * profit rule, or the shop's), plus the product's charge for every colour beyond the first.
   */
  price(
    calculator: UnitCostCalculator,
    p: ConfigurableProduct,
    m: Pick<Measurement, 'grams' | 'printHours' | 'colours'>,
  ): string {
    const base = configuredUnitPrice(
      calculator,
      {
        grams: m.grams,
        printHours: m.printHours,
        pricePerGram: p.material.pricePerGram.toString(),
      },
      [],
      profitOf(p),
    );
    return withPriceOverride(
      calculator,
      p,
      new Prisma.Decimal(base)
        .plus(p.textExtraColourPrice.times(Math.max(0, m.colours.length - 1)))
        .toFixed(2),
    );
  }

  /** The print files for an order line's design: one STL per colour. */
  async printFiles(
    design: TextDesignInput,
    settings: TextSettings,
  ): Promise<{ colour: string; bytes: Uint8Array }[]> {
    // Every font, active or not: an order made with a font switched off since still prints.
    const fonts = new Map((await this.fonts.all()).map((f) => [f.id, f]));
    const used = new Set([
      design.fontId,
      ...(design.accentFontId ? [design.accentFontId] : []),
      ...(design.letters ?? []).flatMap((l) => l.fontId ?? []),
      ...(design.items ?? []).flatMap((i) => i.fontId ?? []),
    ]);
    const logoIds = [
      ...(design.logoId ? [design.logoId] : []),
      ...(design.items ?? []).flatMap((i) => i.logoId ?? []),
    ];
    const files = await this.shaper.stl(
      [...used].flatMap((id) => {
        const f = fonts.get(id);
        return f ? [{ id, read: () => this.uploads.read(f.fileKey) }] : [];
      }),
      design,
      settings,
      logoIds.length ? await this.logos.outlines([...new Set(logoIds)]) : [],
    );
    if ('problem' in files) throw new BadRequestException(files.problem);
    return files;
  }

  /**
   * The word "Forgea" made in the product's style, first font and starting colours (ours:
   * copper letters on black, and the accent), as one GLB with a material per colour, stored
   * like an upload (once per content): the product's model in the shop, its cards and the home
   * page bed. Null when it can't be made (no font, no colour).
   */
  async sampleModel(p: ConfigurableProduct): Promise<string | null> {
    const settings = this.settings(p);
    const font = (await this.fonts.active()).find((f) => f.latin);
    const values = p.textColourGroup?.values ?? [];
    const pick = (id: string | null) => values.find((v) => v.id === id);
    const letters = pick(p.textDefaultColourId) ?? values[0];
    if (!settings || !font || !letters) return null;
    const base = pick(p.textDefaultBaseId);
    const accent = ACCENT_STYLES.includes(settings.style)
      ? pick(p.textDefaultAccentId)
      : undefined;
    const files = await this.shaper.stl(
      [{ id: font.id, read: () => this.uploads.read(font.fileKey) }],
      {
        text:
          settings.style === 'COUPLE'
            ? SAMPLE_TEXT.COUPLE
            : SAMPLE_TEXT[settings.style].slice(0, settings.maxChars),
        fontId: font.id,
        textColour: letters.id,
        ...(base ? { baseColour: base.id } : {}),
        ...(accent ? { accentColour: accent.id } : {}),
        // A board piece shows the shop's name on its face, in the second colour.
        ...(BOARD_STYLES.includes(settings.style)
          ? {
              items: [
                {
                  id: 'sample',
                  kind: 'TEXT' as const,
                  text: 'Forgea',
                  x: 0,
                  y: 0,
                  size: Math.round(settings.letterHeightMm * 0.16),
                  rotation: 0,
                  colour: (
                    base ??
                    values.find((v) => v.id !== letters.id) ??
                    letters
                  ).id,
                },
              ],
            }
          : {}),
      },
      settings,
    );
    if ('problem' in files || files.length === 0) return null;
    const data = sampleGlb(
      files.map((f) => ({
        bytes: f.bytes,
        hex: pick(f.colour)?.swatchHex ?? '#b87333',
      })),
      !STANDING_STYLES.includes(settings.style) &&
        !BOARD_STYLES.includes(settings.style),
    );
    const sha256 = createHash('sha256').update(data).digest('hex');
    const known = await this.uploads.findCleanBySha256(
      sha256,
      UploadPurpose.PRODUCT_MODEL,
    );
    if (known) return known;
    const upload = await this.uploads.receive(
      { data: Buffer.from(data), originalName: SAMPLE_MODEL_NAMES[0] },
      UploadPurpose.PRODUCT_MODEL,
      null,
    );
    return upload.status === UploadStatus.CLEAN ? upload.storageKey : null;
  }

  private settings(p: ConfigurableProduct): TextSettings | null {
    if (
      !p.textStyle ||
      p.textMaxChars === null ||
      !p.textHeightMm ||
      !p.textDepthMm ||
      !p.textBaseMm ||
      !p.textMaxWidthMm
    )
      return null;
    return {
      style: p.textStyle,
      maxChars: p.textMaxChars,
      letterHeightMm: Number(p.textHeightMm),
      letterDepthMm: Number(p.textDepthMm),
      baseDepthMm: Number(p.textBaseMm),
      maxWidthMm: Number(p.textMaxWidthMm),
      ...(p.textDecor ? { decor: p.textDecor } : {}),
    };
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The browser's measurement, if it could be this design's: its colours are the design's, and
 * no part is bigger than the piece's box, which itself fits the product's limits. It is only
 * ever a display price (checkout measures on the server), so this keeps out nonsense, not
 * fraud.
 */
function plausible(
  given: DesignMeasurement,
  design: TextDesignInput,
  settings: TextSettings,
  letters: readonly { colour?: string | undefined }[],
): Measured {
  const allowed = new Set([
    design.textColour,
    ...(design.baseColour ? [design.baseColour] : []),
    ...(design.accentColour ? [design.accentColour] : []),
    ...(design.decorColour ? [design.decorColour] : []),
    ...letters.flatMap((l) => l.colour ?? []),
    ...(design.logoColours ?? []),
    ...(design.items ?? []).map((i) => i.colour),
  ]);
  const { x, y, z } = given.size;
  // Generous: decorations, a keyring loop and a backing plate stand out past the letters.
  const reach = 2 * settings.maxWidthMm + 4 * settings.letterHeightMm + 40;
  const box = x * y * z;
  const fits =
    given.parts.length > 0 &&
    given.parts.every((part) => allowed.has(part.colour)) &&
    Math.max(x, y, z) <= reach &&
    given.parts.reduce((s, part) => s + part.volumeMm3, 0) <= box &&
    given.parts.some((part) => part.volumeMm3 > 0);
  if (!fits)
    throw new BadRequestException(
      'The price could not be worked out. Reload the page and try again.',
    );
  return { problem: null, parts: given.parts, size: given.size };
}

/**
 * The original names generated sample models are stored under (the owner's own models never
 * are): the GLB in colour, and the one-colour STL made before it.
 */
export const SAMPLE_MODEL_NAMES = [
  'forgea-sample.glb',
  'forgea-sample.stl',
] as const;

/** The text a product's sample shows in the shop, by style. */
const SAMPLE_TEXT: Record<TextSettings['style'], string> = {
  KEYCHAIN: 'Forgea',
  NAME: 'Forgea',
  MONOGRAM: 'FRG',
  LETTERS: 'FORGEA',
  INITIAL_NAME: 'Forgea',
  COUPLE: 'Forge & Lab',
  STANDING_INITIAL: 'F',
  TROPHY: '',
};
