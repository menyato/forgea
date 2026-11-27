import { Injectable } from '@nestjs/common';
import {
  type CostSettings,
  type OrderSettings,
  type PrinterCosts,
  printerHourlyRate,
} from '@forgea/pricing';
import { PrismaService } from '../database/prisma.service.js';

/** The current settings, split by audience: cost is server-only, order is public. */
export interface PricingSettingsSnapshot {
  cost: CostSettings;
  order: OrderSettings;
  /**
   * The pricing printer's details, read from the printer itself (price, life, watts) with the
   * studio's electricity; null when the hourly rate is typed in, or that printer lacks a price.
   */
  printer: PrinterCosts | null;
  /** The printer prices are worked out from (Dashboard → Printers). */
  pricingPrinterId: string | null;
  /** What a kWh costs the studio (USD). */
  electricityPerKwh: string | null;
}

/** A printer's own details, as pricing reads them. */
export interface PricingPrinter {
  priceUsd: string | null;
  lifeHours: number | null;
  watts: number;
}

/** Data access for pricing settings. Abstract so services and tests depend on the contract. */
export abstract class PricingSettingsRepository {
  abstract current(): Promise<PricingSettingsSnapshot>;
  /** Replaces every setting and the bulk discount tiers at once. */
  abstract save(
    settings: PricingSettingsSnapshot,
    adminId: string,
  ): Promise<void>;
  abstract printer(id: string): Promise<PricingPrinter | null>;
}

@Injectable()
export class PrismaPricingSettingsRepository extends PricingSettingsRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async save(s: PricingSettingsSnapshot, adminId: string): Promise<void> {
    const { bulkDiscountTiers, ...order } = s.order;
    const { profit, ...cost } = s.cost;
    await this.prisma.$transaction([
      this.prisma.pricingSettings.update({
        where: { id: 1 },
        data: {
          ...cost,
          ...order,
          profitKind: profit.kind,
          profitValue: String(profit.value),
          pricingPrinterId: s.pricingPrinterId,
          electricityPerKwh: s.electricityPerKwh,
          updatedByUserId: adminId,
        },
      }),
      this.prisma.bulkDiscountTier.deleteMany(),
      this.prisma.bulkDiscountTier.createMany({ data: [...bulkDiscountTiers] }),
    ]);
  }

  async current(): Promise<PricingSettingsSnapshot> {
    const [s, tiers] = await Promise.all([
      // The migration creates row 1; its absence is a deployment error, not a user error.
      this.prisma.pricingSettings.findUniqueOrThrow({
        where: { id: 1 },
        include: { pricingPrinter: true },
      }),
      this.prisma.bulkDiscountTier.findMany({
        orderBy: { minQuantity: 'asc' },
      }),
    ]);
    const p = s.pricingPrinter;
    const printer: PrinterCosts | null =
      p && p.priceUsd !== null && p.lifeHours !== null && s.electricityPerKwh
        ? {
            printerPrice: p.priceUsd.toString(),
            lifeHours: p.lifeHours,
            watts: p.watts,
            electricityPerKwh: s.electricityPerKwh.toString(),
          }
        : null;
    return {
      cost: {
        // From the printer as it is now: a change to it prices the next quote.
        machineRatePerHour: printer
          ? printerHourlyRate(printer)
          : s.machineRatePerHour.toString(),
        purgeWastePercent: s.purgeWastePercent.toString(),
        failureAllowancePercent: s.failureAllowancePercent.toString(),
        laborCostPerUnit: s.laborCostPerUnit.toString(),
        packagingCostPerUnit: s.packagingCostPerUnit.toString(),
        profit: { kind: s.profitKind, value: s.profitValue.toString() },
        priceStep: s.priceStep.toString(),
      },
      order: {
        rushFeePercent: s.rushFeePercent.toString(),
        deliveryFee: s.deliveryFee.toString(),
        depositPercent: s.depositPercent.toString(),
        depositEnabled: s.depositEnabled,
        depositAboveTotal: s.depositAboveTotal?.toString() ?? null,
        depositOnCustom: s.depositOnCustom,
        bulkDiscountTiers: tiers.map((t) => ({
          minQuantity: t.minQuantity,
          percent: t.percent.toString(),
        })),
      },
      printer,
      pricingPrinterId: s.pricingPrinterId,
      electricityPerKwh: s.electricityPerKwh?.toString() ?? null,
    };
  }

  async printer(id: string): Promise<PricingPrinter | null> {
    const p = await this.prisma.printer.findUnique({
      where: { id },
      select: { priceUsd: true, lifeHours: true, watts: true },
    });
    return p
      ? {
          priceUsd: p.priceUsd?.toString() ?? null,
          lifeHours: p.lifeHours,
          watts: p.watts,
        }
      : null;
  }
}
