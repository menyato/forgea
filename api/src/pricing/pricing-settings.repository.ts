import { Injectable } from '@nestjs/common';
import type { CostSettings, OrderSettings } from '@forgea/pricing';
import { PrismaService } from '../database/prisma.service.js';

/** The current settings, split by audience: cost is server-only, order is public. */
export interface PricingSettingsSnapshot {
  cost: CostSettings;
  order: OrderSettings;
}

/** Data access for pricing settings. Abstract so services and tests depend on the contract. */
export abstract class PricingSettingsRepository {
  abstract current(): Promise<PricingSettingsSnapshot>;
  /** Replaces every setting and the bulk discount tiers at once. */
  abstract save(
    settings: PricingSettingsSnapshot,
    adminId: string,
  ): Promise<void>;
}

@Injectable()
export class PrismaPricingSettingsRepository extends PricingSettingsRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async save(s: PricingSettingsSnapshot, adminId: string): Promise<void> {
    const { bulkDiscountTiers, ...order } = s.order;
    await this.prisma.$transaction([
      this.prisma.pricingSettings.update({
        where: { id: 1 },
        data: { ...s.cost, ...order, updatedByUserId: adminId },
      }),
      this.prisma.bulkDiscountTier.deleteMany(),
      this.prisma.bulkDiscountTier.createMany({ data: [...bulkDiscountTiers] }),
    ]);
  }

  async current(): Promise<PricingSettingsSnapshot> {
    const [s, tiers] = await Promise.all([
      // The migration creates row 1; its absence is a deployment error, not a user error.
      this.prisma.pricingSettings.findUniqueOrThrow({ where: { id: 1 } }),
      this.prisma.bulkDiscountTier.findMany({
        orderBy: { minQuantity: 'asc' },
      }),
    ]);
    return {
      cost: {
        machineRatePerHour: s.machineRatePerHour.toString(),
        purgeWastePercent: s.purgeWastePercent.toString(),
        failureAllowancePercent: s.failureAllowancePercent.toString(),
        laborCostPerUnit: s.laborCostPerUnit.toString(),
        packagingCostPerUnit: s.packagingCostPerUnit.toString(),
        markupMultiplier: s.markupMultiplier.toString(),
      },
      order: {
        rushFeePercent: s.rushFeePercent.toString(),
        deliveryFee: s.deliveryFee.toString(),
        depositPercent: s.depositPercent.toString(),
        bulkDiscountTiers: tiers.map((t) => ({
          minQuantity: t.minQuantity,
          percent: t.percent.toString(),
        })),
      },
    };
  }
}
