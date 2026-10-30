import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { StoreSettings } from '../generated/prisma/client.js';

/** The single store_settings row (id = 1), created by its migration. */
const SINGLETON = { id: 1 } as const;

@Injectable()
export class StoreSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  get(): Promise<StoreSettings> {
    return this.prisma.storeSettings.findUniqueOrThrow({ where: SINGLETON });
  }

  update(
    data: Pick<
      StoreSettings,
      'transferPhone' | 'transferInstructions' | 'whatsappPhone'
    >,
    updatedByUserId: string,
  ): Promise<StoreSettings> {
    return this.prisma.storeSettings.update({
      where: SINGLETON,
      data: { ...data, updatedByUserId },
    });
  }

  updateRequestRules(
    data: Pick<
      StoreSettings,
      | 'quoteValidityDays'
      | 'depositRefundable'
      | 'customUploadMaxMb'
      | 'estimateSolidityPercent'
      | 'estimateSpreadPercent'
    >,
    updatedByUserId: string,
  ): Promise<StoreSettings> {
    return this.prisma.storeSettings.update({
      where: SINGLETON,
      data: { ...data, updatedByUserId },
    });
  }

  updateQuotationEmail(
    data: Pick<
      StoreSettings,
      'quotationEmailSubject' | 'quotationEmailIntro' | 'quotationEmailClosing'
    >,
    updatedByUserId: string,
  ): Promise<StoreSettings> {
    return this.prisma.storeSettings.update({
      where: SINGLETON,
      data: { ...data, updatedByUserId },
    });
  }
}
