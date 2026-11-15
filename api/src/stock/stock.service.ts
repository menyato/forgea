import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  pricePerGramFromReel,
  PricingError,
  shareDiscount,
} from '@forgea/pricing';
import type {
  ChosenOption,
  DateRange,
  GramsCost,
  Page,
  StockItemView,
  StockMovementCounts,
  StockMovementView,
  StockOverview,
  StockPrintable,
} from '@forgea/types';
import type {
  CreateStockItemDto,
  ReceiveSpoolsDto,
  RecordStockMovementDto,
  SaveStockItemDto,
  StockCountDto,
  VendorPurchaseDto,
  StockMovementListQuery,
  StudioPrintDto,
} from '@forgea/validation';
import { startingChoice } from '@forgea/types';
import { toPage } from '../common/pagination/keyset.js';
import { claimRequestKey } from '../common/request-key.js';
import { Purchases } from '../accounting/purchases.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  ReadyPieceMovementKind,
  StockMovementKind,
} from '../generated/prisma/enums.js';
import { sizeLabel } from './production-estimate.js';
import { ProductionEstimator } from './production-estimator.js';
import {
  pieceDetails,
  ReadyPiecesRepository,
} from './ready-pieces.repository.js';
import { restockAdvice } from './restock.js';
import { type MovementRow, StockRepository } from './stock.repository.js';

const key = (materialId: string, colour: string) =>
  `${materialId}\u0000${colour}`;

/** Filament on the shelf, what open orders will take, how fast it goes and what to buy. */
@Injectable()
export class StockService {
  constructor(
    private readonly stock: StockRepository,
    private readonly estimator: ProductionEstimator,
    private readonly purchases: Purchases,
    private readonly pieces: ReadyPiecesRepository,
  ) {}

  async overview(today: string, usage: DateRange): Promise<StockOverview> {
    const [items, rows, costs, canBook] = await Promise.all([
      this.items(today),
      this.stock.usageByProduct(usage),
      this.stock.costs(usage),
      this.purchases.canBook(),
    ]);
    const of = (kind: StockMovementKind): GramsCost => {
      const row = costs.get(kind);
      return {
        grams: row?.grams ?? 0,
        cost: new Prisma.Decimal(row?.cost ?? 0).toFixed(2),
      };
    };
    return {
      items,
      costs: {
        bought: of(StockMovementKind.RECEIVED),
        orders: of(StockMovementKind.ORDER),
        studio: of(StockMovementKind.USED),
        failed: of(StockMovementKind.FAILED_PRINT),
      },
      canBookPurchases: canBook,
      usage: { range: usage, rows },
    };
  }

  async movements(
    query: StockMovementListQuery,
  ): Promise<Page<StockMovementView>> {
    return toPage(await this.stock.movements(query), toMovementView);
  }

  movementCounts(stockItemId?: string): Promise<StockMovementCounts> {
    return this.stock.movementCounts(stockItemId);
  }

  /**
   * Every stock line with its advice. A line exists once filament came in or went out for that
   * material and colour (a delivery, or the first order of it going into production).
   */
  async items(today: string): Promise<StockItemView[]> {
    const [rows, open, swatches] = await Promise.all([
      this.stock.rows(today),
      this.stock.openLines(),
      this.stock.swatches(),
    ]);
    const { estimate } = await this.estimator.for(open);
    const committed = new Map<string, number>();
    for (const line of open) {
      const e = estimate(line);
      if (!e) continue;
      for (const part of e.colours ?? [
        { colour: e.colour, gramsPerUnit: e.gramsPerUnit },
      ]) {
        const k = key(e.materialId, part.colour);
        const grams = new Prisma.Decimal(part.gramsPerUnit)
          .times(line.units)
          .ceil()
          .toNumber();
        committed.set(k, (committed.get(k) ?? 0) + grams);
      }
    }
    return rows.map((r): StockItemView => {
      const committedGrams = committed.get(key(r.materialId, r.colour)) ?? 0;
      const advice = restockAdvice({
        stockGrams: r.stock,
        committedGrams,
        used30Grams: r.used30,
        used90Grams: r.used90,
        lowStockGrams: r.lowStockGrams,
        spoolGrams: r.spoolGrams,
        leadTimeDays: r.leadTimeDays,
        coverDays: r.coverDays,
      });
      return {
        id: r.id,
        material: { id: r.materialId, code: r.code, name: r.name },
        colour: r.colour,
        swatchHex: r.hex ?? swatches.get(r.colour) ?? null,
        hex: r.hex,
        costPerGram: new Prisma.Decimal(
          r.ownPricePerGram ?? r.pricePerGram,
        ).toFixed(4),
        active: r.active,
        stockGrams: r.stock,
        committedGrams,
        availableGrams: advice.availableGrams,
        used30Grams: r.used30,
        used90Grams: r.used90,
        lastMovedAt: r.lastMovedAt?.toISOString() ?? null,
        dailyUseGrams: advice.dailyUseGrams.toFixed(1),
        daysLeft: advice.daysLeft,
        reorderPointGrams: advice.reorderPointGrams,
        // A line switched off (a colour no longer sold) is never flagged.
        needsRestock: r.active && advice.needsRestock,
        suggestSpools: r.active ? advice.suggestSpools : 0,
        suggestGrams: r.active ? advice.suggestGrams : 0,
        lowStockGrams: r.lowStockGrams,
        spoolGrams: r.spoolGrams,
        leadTimeDays: r.leadTimeDays,
        coverDays: r.coverDays,
      };
    });
  }

  /** A delivery, other use, or a count correction, by the team. */
  async record(dto: RecordStockMovementDto, actorId: string): Promise<void> {
    if (!(await this.stock.materialExists(dto.materialId))) {
      throw new NotFoundException('Material not found');
    }
    const kind = StockMovementKind[dto.kind];
    const grams = kind === StockMovementKind.USED ? -dto.grams : dto.grams;
    if (kind !== StockMovementKind.CORRECTION && grams === 0) {
      throw new BadRequestException('Enter how many grams');
    }
    await this.stock.transaction((tx) =>
      this.stock.record(tx, [
        {
          materialId: dto.materialId,
          colour: dto.colour,
          kind,
          grams,
          note: dto.note || null,
          createdById: actorId,
        },
      ]),
    );
  }

  /**
   * Spools received: their grams go on the shelf with what they cost. Their price becomes the
   * material's cost per gram (unless the owner says not to), and paid from the cash box or a
   * transfer it is booked as a purchase, all in one transaction.
   */
  async receive(dto: ReceiveSpoolsDto, actorId: string): Promise<void> {
    const material = await this.stock.material(dto.materialId);
    if (!material) throw new NotFoundException('Material not found');
    const grams = dto.spools * dto.spoolGrams;
    const cost = new Prisma.Decimal(dto.pricePerSpool).times(dto.spools);
    const costPerGram = pricePerGramFromReel(dto.pricePerSpool, dto.spoolGrams);
    const what = `${dto.spools} × ${material.code}${dto.colour ? ` ${dto.colour}` : ''} (${dto.spoolGrams} g)`;
    await this.stock.transaction(async (tx) => {
      if (!(await claimRequestKey(tx, dto.requestKey, 'stock.receive'))) return;
      const entry =
        dto.paidFrom && cost.gt(0)
          ? await this.purchases.book(tx, {
              paidFrom: dto.paidFrom,
              amount: cost,
              label: `Filament: ${what}`,
              actorId,
            })
          : null;
      if (dto.updateCost) {
        await this.stock.setReel(tx, material.id, {
          price: dto.pricePerSpool,
          grams: dto.spoolGrams,
          pricePerGram: costPerGram,
        });
      }
      await this.stock.record(tx, [
        {
          materialId: material.id,
          colour: dto.colour,
          kind: StockMovementKind.RECEIVED,
          grams,
          cost: cost.toFixed(2),
          costPerGram,
          journalEntryId: entry?.id ?? null,
          note: dto.note || what,
          createdById: actorId,
        },
      ]);
      if (dto.hex && dto.colour)
        await this.stock.setColourHex(tx, material.id, dto.colour, dto.hex);
      // The filament itself costs what these spools cost, whatever the material's price.
      if (new Prisma.Decimal(costPerGram).gt(0))
        await this.stock.setFilamentPrice(
          tx,
          material.id,
          dto.colour,
          costPerGram,
        );
    });
  }

  /** Products the studio can print for itself or record a failure of, with one's grams and cost. */
  async printables(id?: string): Promise<StockPrintable[]> {
    const products = await this.stock.printables(id);
    const { estimate } = await this.estimator.for(
      products.map((p) => ({ productId: p.id, options: [] })),
    );
    return products.flatMap((p) => {
      const one = estimate({ productId: p.id, options: [] });
      if (!one) return [];
      return [
        {
          id: p.id,
          name: p.name,
          materialCode: p.material.code,
          sizes: p.sizes.map(sizeLabel),
          colours: coloursOf(p).map(({ label, swatchHex }) => ({
            label,
            swatchHex,
          })),
          parts: partsOf(p),
          gramsPerUnit: one.gramsPerUnit,
          unitCost: one.unitCost,
        },
      ];
    });
  }

  /**
   * Pieces printed for the studio (samples, display, gifts, stock made ahead) or a failed
   * print of a product: the filament comes off the shelf by the product's own grams (its size
   * and colour), costed with machine time; a failure only as far as it got.
   */
  async studioPrint(
    dto: StudioPrintDto,
    failed: boolean,
    actorId: string,
  ): Promise<{ grams: number; cost: string }> {
    const [product] = await this.stock.printables(dto.productId);
    if (!product) throw new NotFoundException('Product not found');
    const colours = coloursOf(product);
    const colour = dto.colour
      ? colours.find((c) => c.label === dto.colour)
      : undefined;
    if (dto.colour && !colour)
      throw new BadRequestException('Choose one of its colours');
    // Each recoloured part in the colour it was printed in (all of them, each once).
    const partNames = partsOf(product).map((p) => p.name);
    if (dto.parts?.length) {
      const names = dto.parts.map((p) => p.part);
      if (
        partNames.length === 0 ||
        names.length !== partNames.length ||
        new Set(names).size !== names.length ||
        !partNames.every((n) => names.includes(n))
      )
        throw new BadRequestException('Choose a colour for each of its parts');
      if (!dto.parts.every((p) => colours.some((c) => c.label === p.colour)))
        throw new BadRequestException('Choose one of its colours');
    }
    if (!dto.colour && !dto.parts?.length && colours.length > 0)
      throw new BadRequestException('Choose the colour it was printed in');
    const sizes = product.sizes.map(sizeLabel);
    if (dto.size && !sizes.includes(dto.size))
      throw new BadRequestException('Choose one of its sizes');
    const options: ChosenOption[] = [
      // A recoloured piece: each part in its own colour, or every part in the one colour.
      ...(dto.parts?.length
        ? dto.parts.map((p) => ({ group: p.part, value: p.colour }))
        : colour
          ? colour.parts.length > 0
            ? colour.parts.map((part) => ({ group: part, value: colour.label }))
            : [{ group: colour.group, value: colour.label }]
          : []),
      ...(dto.size ? [{ group: 'Size', value: dto.size }] : []),
    ];
    const line = { productId: product.id, options };
    const { estimate, catalog } = await this.estimator.for([line]);
    const e = estimate(line);
    if (!e) {
      throw new BadRequestException(
        "This product can't be costed: check its material and grams",
      );
    }
    const share = failed ? (dto.progressPercent ?? 100) / 100 : 1;
    const grams = Math.max(
      1,
      new Prisma.Decimal(e.gramsPerUnit)
        .times(dto.quantity)
        .times(share)
        .ceil()
        .toNumber(),
    );
    const cost = new Prisma.Decimal(e.unitCost)
      .times(dto.quantity)
      .times(share)
      .toFixed(2);
    // As orders do: each colour from its own reel (a part's chosen filament, PETG supports
    // from the PETG shelf), its share of the grams and of the cost.
    const parts = e.colours ?? [
      { colour: colour?.label ?? e.colour, gramsPerUnit: e.gramsPerUnit },
    ];
    const total = parts.reduce((n, p) => n + Number(p.gramsPerUnit), 0);
    const note =
      dto.note ||
      (failed && dto.progressPercent !== undefined
        ? `Failed at ${dto.progressPercent}%`
        : null);
    const movements = parts.flatMap((part) => {
      const share = total > 0 ? Number(part.gramsPerUnit) / total : 1;
      const partGrams = Math.max(1, Math.ceil(grams * share));
      const materialId =
        ('materialId' in part ? part.materialId : undefined) ?? e.materialId;
      return [
        {
          materialId,
          colour: part.colour,
          kind: failed
            ? StockMovementKind.FAILED_PRINT
            : StockMovementKind.USED,
          grams: -partGrams,
          cost: new Prisma.Decimal(cost).times(share).toFixed(2),
          costPerGram: catalog.pricePerGram.get(materialId) ?? null,
          productId: product.id,
          quantity: dto.quantity,
          note,
          createdById: actorId,
        },
      ];
    });
    await this.stock.transaction(async (tx) => {
      if (!(await claimRequestKey(tx, dto.requestKey, 'stock.studio-print')))
        return;
      await this.stock.record(tx, movements);
      // Printed to sell: the pieces wait on the shelf, at what they cost to make.
      if (!failed && dto.toShelf)
        await this.pieces.add(tx, {
          productId: product.id,
          name: product.name,
          details: pieceDetails(options, null),
          kind: ReadyPieceMovementKind.PRINTED,
          quantity: dto.quantity,
          unitCost: e.unitCost,
          note: dto.note || null,
          createdById: actorId,
        });
    });
    return { grams, cost };
  }

  /**
   * A vendor's bill: every line's reels go on the shelf at what they really cost (the bill's
   * discount shared by price), each reel keeping its own price per gram and look; paid from the
   * cash box or a transfer, the bill is booked once as a purchase. All or nothing.
   */
  async vendorPurchase(
    dto: VendorPurchaseDto,
    actorId: string,
  ): Promise<{ total: string; reels: number }> {
    const materials = new Map<string, { id: string; code: string }>();
    for (const id of new Set(dto.lines.map((l) => l.materialId))) {
      const m = await this.stock.material(id);
      if (!m) throw new NotFoundException('Material not found');
      materials.set(id, m);
    }
    let net: string[];
    try {
      net = shareDiscount(
        dto.lines.map((l) =>
          new Prisma.Decimal(l.pricePerSpool).times(l.spools).toFixed(2),
        ),
        dto.discount,
      );
    } catch (error) {
      if (error instanceof PricingError)
        throw new BadRequestException(error.message);
      throw error;
    }
    const total = net.reduce((n, x) => n.plus(x), new Prisma.Decimal(0));
    const bill = `${dto.vendor}${dto.reference ? ` ${dto.reference}` : ''}`;
    await this.stock.transaction(async (tx) => {
      if (!(await claimRequestKey(tx, dto.requestKey, 'stock.vendor-purchase')))
        return;
      const entry =
        dto.paidFrom && total.gt(0)
          ? await this.purchases.book(tx, {
              paidFrom: dto.paidFrom,
              amount: total,
              label: `Filament: ${bill}`,
              actorId,
            })
          : null;
      for (const [i, line] of dto.lines.entries()) {
        const material = materials.get(line.materialId)!;
        const grams = line.spools * line.spoolGrams;
        const cost = new Prisma.Decimal(net[i]!);
        const costPerGram = cost.div(grams).toDecimalPlaces(4).toFixed(4);
        await this.stock.record(tx, [
          {
            materialId: material.id,
            colour: line.colour,
            kind: StockMovementKind.RECEIVED,
            grams,
            cost: cost.toFixed(2),
            costPerGram,
            journalEntryId: entry?.id ?? null,
            note: `${line.spools} × ${material.code} ${line.colour} (${line.spoolGrams} g) · ${bill}`,
            createdById: actorId,
          },
        ]);
        if (line.hex)
          await this.stock.setColourHex(tx, material.id, line.colour, line.hex);
        if (cost.gt(0))
          await this.stock.setFilamentPrice(
            tx,
            material.id,
            line.colour,
            costPerGram,
          );
      }
    });
    return {
      total: total.toFixed(2),
      reels: dto.lines.reduce((n, l) => n + l.spools, 0),
    };
  }

  /** The spools weighed: the difference from what the shelf should hold is recorded. */
  async count(
    dto: StockCountDto,
    actorId: string,
  ): Promise<{ difference: number }> {
    if (!(await this.stock.materialExists(dto.materialId))) {
      throw new NotFoundException('Material not found');
    }
    return this.stock.transaction(async (tx) => {
      const before = await this.stock.onShelf(tx, dto.materialId, dto.colour);
      const difference = dto.gramsOnShelf - before;
      if (difference !== 0) {
        await this.stock.record(tx, [
          {
            materialId: dto.materialId,
            colour: dto.colour,
            kind: StockMovementKind.CORRECTION,
            grams: difference,
            note: dto.note || `Weighed: ${dto.gramsOnShelf} g on the shelf`,
            createdById: actorId,
          },
        ]);
      }
      if (dto.hex && dto.colour)
        await this.stock.setColourHex(tx, dto.materialId, dto.colour, dto.hex);
      return { difference };
    });
  }

  /** A new filament, before any spool of it is received: it starts with nothing on the shelf. */
  async createItem(dto: CreateStockItemDto): Promise<{ id: string }> {
    if (!(await this.stock.materialExists(dto.materialId)))
      throw new BadRequestException('Choose a material');
    const perGram = dto.spoolPrice
      ? pricePerGramFromReel(dto.spoolPrice, dto.spoolGrams)
      : null;
    // A price too small to show in a tenth of a cent per gram is no price.
    const price = perGram && new Prisma.Decimal(perGram).gt(0) ? perGram : null;
    try {
      const { id } = await this.stock.createItem({
        materialId: dto.materialId,
        colour: dto.colour,
        hex: dto.hex ?? null,
        pricePerGram: price,
        lowStockGrams: dto.lowStockGrams,
        spoolGrams: dto.spoolGrams,
        leadTimeDays: dto.leadTimeDays,
        coverDays: dto.coverDays,
        active: dto.active,
      });
      return { id };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'That filament is already in stock: open it from the list.',
        );
      throw error;
    }
  }

  async saveItem(id: string, dto: SaveStockItemDto): Promise<void> {
    if (!(await this.stock.findItem(id)))
      throw new NotFoundException('Stock line not found');
    await this.stock.updateItem(id, dto);
  }
}

/**
 * A product's colours with the option group they come from: personalised, its text colours; with
 * parts customers recolour, the colours those parts are chosen in (`parts`: the parts' names).
 */
function coloursOf(p: {
  optionValues: {
    value: { label: string; swatchHex: string | null; group: { name: string } };
  }[];
  textColourGroup: {
    name: string;
    values: { label: string; swatchHex: string | null }[];
  } | null;
  colours: { part: string | null }[];
  partColourGroup: {
    name: string;
    values: { label: string; swatchHex: string | null }[];
  } | null;
}): {
  label: string;
  swatchHex: string | null;
  group: string;
  parts: string[];
}[] {
  const parts = [
    ...new Set(p.colours.flatMap((c) => (c.part ? [c.part] : []))),
  ];
  const all =
    parts.length > 0 && p.partColourGroup
      ? p.partColourGroup.values.map((v) => ({
          ...v,
          group: p.partColourGroup!.name,
          parts,
        }))
      : p.textColourGroup
        ? p.textColourGroup.values.map((v) => ({
            ...v,
            group: p.textColourGroup!.name,
            parts: [],
          }))
        : p.optionValues.map(({ value: v }) => ({
            label: v.label,
            swatchHex: v.swatchHex,
            group: v.group.name,
            parts: [],
          }));
  const seen = new Set<string>();
  return all.filter((c) => !seen.has(c.label) && seen.add(c.label));
}

/** A product's recoloured parts (once each, in the file's order) and the colour each starts in. */
function partsOf(p: {
  colours: {
    part: string | null;
    colour: string;
    hex: string;
    stockItemId: string | null;
    startsAs: string | null;
  }[];
  partColourGroup: {
    values: {
      label: string;
      swatchHex: string | null;
      stockItemId: string | null;
    }[];
  } | null;
}): { name: string; startsAs: string }[] {
  const group = p.partColourGroup;
  if (!group || group.values.length === 0) return [];
  const seen = new Set<string>();
  return p.colours.flatMap((row) => {
    if (!row.part || seen.has(row.part)) return [];
    seen.add(row.part);
    const start = startingChoice(group.values, row) ?? group.values[0]!;
    return [{ name: row.part, startsAs: start.label }];
  });
}

function toMovementView(m: MovementRow): StockMovementView {
  return {
    id: m.id,
    createdAt: m.createdAt.toISOString(),
    kind: m.kind,
    stockItemId: m.stockItemId,
    grams: m.grams,
    materialCode: m.stockItem.material.code,
    colour: m.stockItem.colour,
    note: m.note,
    orderNumber: m.orderItem?.order.orderNumber ?? null,
    product: m.product?.name ?? null,
    quantity: m.quantity,
    // Orders' filament at its cost per gram when it went out (or today's).
    cost:
      m.cost?.toFixed(2) ??
      (m.kind === StockMovementKind.ORDER
        ? (m.costPerGram ?? m.stockItem.material.pricePerGram)
            .times(Math.abs(m.grams))
            .toFixed(2)
        : null),
    entryNumber: m.journalEntry?.number ?? null,
    by: m.createdBy ? (m.createdBy.name ?? m.createdBy.email) : null,
  };
}
