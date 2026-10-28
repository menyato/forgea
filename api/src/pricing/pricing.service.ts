import { BadRequestException, Injectable } from '@nestjs/common';
import {
  type OrderLineInput,
  type OrderOptions,
  type OrderQuote,
  OrderPricer,
  type OrderSettings,
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
    const next: PricingSettingsSnapshot = {
      cost: {
        machineRatePerHour: dto.machineRatePerHour,
        purgeWastePercent: dto.purgeWastePercent,
        failureAllowancePercent: dto.failureAllowancePercent,
        laborCostPerUnit: dto.laborCostPerUnit,
        packagingCostPerUnit: dto.packagingCostPerUnit,
        markupMultiplier: dto.markupMultiplier,
      },
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
    new UnitCostCalculator(next.cost);
    new OrderPricer(next.order);
    await this.stored.save(next, adminId);
    return next;
  }

  /** Customer-facing settings for live totals in the browser. Contains no cost data. */
  async publicOrderSettings(): Promise<OrderSettings> {
    return (await this.stored.current()).order;
  }

  /** Server-only: the unit price of a print, with its full cost breakdown. */
  async unitPrice(input: UnitCostInput): Promise<UnitPriceBreakdown> {
    return (await this.costCalculator()).price(input);
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
