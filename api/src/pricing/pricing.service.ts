import { BadRequestException, Injectable } from '@nestjs/common';
import {
  type OrderLineInput,
  type OrderOptions,
  type OrderQuote,
  OrderPricer,
  type OrderSettings,
  type PrinterCosts,
  type QuoteAdjustments,
  type QuoteBreakdown,
  quoteWith,
  PricingError,
  printerHourlyRate,
  splitPrinterCost,
  type ProfitRule,
  type UnitCostInput,
  UnitCostCalculator,
} from '@forgea/pricing';
import type { UpdatePricingSettingsDto } from '@forgea/validation';
import {
  PricingSettingsRepository,
  type PricingSettingsSnapshot,
} from './pricing-settings.repository.js';

/**
 * Applies the shared pricing engine to the settings stored in the database.
 * Settings are read per call, so an admin's change takes effect on the next quote.
 */
@Injectable()
export class PricingService {
  constructor(private readonly stored: PricingSettingsRepository) {}

  /** Admin only: every setting, cost included, for the pricing page. */
  settings(): Promise<PricingSettingsSnapshot> {
    return this.stored.current();
  }

  /** Takes effect on the next price quoted; past orders keep the prices they were sold at. */
  async update(
    dto: UpdatePricingSettingsDto,
    adminId: string,
  ): Promise<PricingSettingsSnapshot> {
    const tiers = [...dto.bulkDiscountTiers].sort(
      (a, b) => a.minQuantity - b.minQuantity,
    );
    if (new Set(tiers.map((t) => t.minQuantity)).size !== tiers.length) {
      throw new BadRequestException(
        'Two bulk discounts start at the same quantity',
      );
    }
    const printer = await this.printerOf(dto);
    const next: PricingSettingsSnapshot = {
      cost: {
        // With the printer's details, its hourly cost is worked out from them.
        machineRatePerHour: printer
          ? printerHourlyRate(printer)
          : dto.machineRatePerHour,
        purgeWastePercent: dto.purgeWastePercent,
        failureAllowancePercent: dto.failureAllowancePercent,
        laborCostPerUnit: dto.laborCostPerUnit,
        packagingCostPerUnit: dto.packagingCostPerUnit,
        profit: { kind: dto.profitKind, value: dto.profitValue },
        priceStep: dto.priceStep,
      },
      printer,
      pricingPrinterId: dto.pricingPrinterId ?? null,
      electricityPerKwh: dto.electricityPerKwh ?? null,
      order: {
        rushFeePercent: dto.rushFeePercent,
        deliveryFee: dto.deliveryFee,
        depositPercent: dto.depositPercent,
        bulkDiscountTiers: tiers.map((t) => ({
          minQuantity: t.minQuantity,
          percent: t.percent,
        })),
      },
    };
    // The engine checks the numbers make sense before anything is stored.
    try {
      new UnitCostCalculator(next.cost);
      new OrderPricer(next.order);
    } catch (error) {
      if (error instanceof PricingError)
        throw new BadRequestException(error.message);
      throw error;
    }
    await this.stored.save(next, adminId);
    return next;
  }

  /** Customer-facing settings for live totals in the browser. Contains no cost data. */
  async publicOrderSettings(): Promise<OrderSettings> {
    return (await this.stored.current()).order;
  }

  /** What the shop charges for a print: its unit price, rounded to the shop's price step. */
  async shopPrice(
    input: UnitCostInput,
    profit?: ProfitRule | null,
  ): Promise<string> {
    const calculator = await this.costCalculator();
    return calculator.shopPrice(calculator.price(input, profit).unitPrice);
  }

  /** A quote for `pieces` pieces by the shop's rules, with the owner's adjustments (`quoteWith`). */
  async quote(
    input: UnitCostInput,
    pieces: number,
    adjustments: QuoteAdjustments,
  ): Promise<QuoteBreakdown> {
    return quoteWith(await this.costCalculator(), input, pieces, adjustments);
  }

  /**
   * A printer-time cost shared between wear and electricity, as the owner's printer details
   * share an hour; null when the hourly cost was typed in instead of worked out from them.
   */
  async printerSplit(
    machineCost: string,
  ): Promise<{ wear: string; electricity: string } | null> {
    const { printer } = await this.stored.current();
    return printer ? splitPrinterCost(printer, machineCost) : null;
  }

  /** One calculator for pricing many items with a single settings read (e.g. a product list). */
  async costCalculator(): Promise<UnitCostCalculator> {
    const { cost } = await this.stored.current();
    return new UnitCostCalculator(cost);
  }

  /** The authoritative order price. Checkout calls this; client-side totals are never trusted. */
  async quoteOrder(
    lines: readonly OrderLineInput[],
    options: OrderOptions,
    { bulkDiscounts = true }: { bulkDiscounts?: boolean } = {},
  ): Promise<OrderQuote> {
    const { order } = await this.stored.current();
    return new OrderPricer(
      bulkDiscounts ? order : { ...order, bulkDiscountTiers: [] },
    ).quote(lines, options);
  }

  /**
   * The pricing printer's details, from the printer itself: it needs its price and the hours it
   * lasts (entered on its own page) and the studio's electricity.
   */
  private async printerOf(
    dto: UpdatePricingSettingsDto,
  ): Promise<PrinterCosts | null> {
    if (!dto.pricingPrinterId) return null;
    const p = await this.stored.printer(dto.pricingPrinterId);
    if (!p) throw new BadRequestException('Choose a printer');
    if (p.priceUsd === null || p.lifeHours === null)
      throw new BadRequestException(
        "Fill in that printer's price and the hours it lasts on its page first (Printers), or type the hourly cost yourself",
      );
    if (!dto.electricityPerKwh)
      throw new BadRequestException(
        'Enter what a kWh of electricity costs, to price the printer’s power',
      );
    return {
      printerPrice: p.priceUsd,
      lifeHours: p.lifeHours,
      watts: p.watts,
      electricityPerKwh: dto.electricityPerKwh,
    };
  }
}
