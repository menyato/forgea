import { BadRequestException, Injectable } from '@nestjs/common';
import {
  type OrderLineInput,
  type OrderOptions,
  type OrderQuote,
  OrderPricer,
  type OrderSettings,
  type PrinterCosts,
  PricingError,
  printerHourlyRate,
  splitPrinterCost,
  type ProfitRule,
  type UnitCostInput,
  type UnitPriceBreakdown,
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
    const printer = printerOf(dto);
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
      },
      printer,
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

  /** Server-only: the unit price of a print, with its full cost breakdown. */
  async unitPrice(
    input: UnitCostInput,
    profit?: ProfitRule | null,
  ): Promise<UnitPriceBreakdown> {
    return (await this.costCalculator()).price(input, profit);
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
}

/** The printer's four details, all or none ("fill in all four, or clear them"). */
function printerOf(dto: UpdatePricingSettingsDto): PrinterCosts | null {
  const parts = [
    dto.printerPrice,
    dto.printerLifeHours,
    dto.printerWatts,
    dto.electricityPerKwh,
  ];
  if (parts.every((p) => p === undefined)) return null;
  if (parts.some((p) => p === undefined)) {
    throw new BadRequestException(
      'Fill in all four printer details (price, life, watts, electricity), or clear them to type the hourly cost yourself',
    );
  }
  return {
    printerPrice: dto.printerPrice!,
    lifeHours: dto.printerLifeHours!,
    watts: dto.printerWatts!,
    electricityPerKwh: dto.electricityPerKwh!,
  };
}
