import { Injectable } from '@nestjs/common';
import type { StoreSettings } from '@forgea/types';
import type {
  UpdateRequestSettingsDto,
  UpdateStoreSettingsDto,
} from '@forgea/validation';
import type { StoreSettings as StoreSettingsRow } from '../generated/prisma/client.js';
import { StoreSettingsRepository } from './store-settings.repository.js';

/** The payment and WhatsApp numbers customers see, and the custom-request rules. */
@Injectable()
export class StoreSettingsService {
  constructor(private readonly settings: StoreSettingsRepository) {}

  async get(): Promise<StoreSettings> {
    return toView(await this.settings.get());
  }

  async update(
    dto: UpdateStoreSettingsDto,
    adminId: string,
  ): Promise<StoreSettings> {
    const row = await this.settings.update(
      {
        transferPhone: dto.transferPhone,
        transferInstructions: dto.transferInstructions ?? null,
        whatsappPhone: dto.whatsappPhone,
      },
      adminId,
    );
    return toView(row);
  }

  async updateRequestRules(
    dto: UpdateRequestSettingsDto,
    adminId: string,
  ): Promise<StoreSettings> {
    return toView(await this.settings.updateRequestRules(dto, adminId));
  }
}

function toView(row: StoreSettingsRow): StoreSettings {
  return {
    transferPhone: row.transferPhone,
    transferInstructions: row.transferInstructions,
    whatsappPhone: row.whatsappPhone,
    requests: {
      quoteValidityDays: row.quoteValidityDays,
      depositRefundable: row.depositRefundable,
      customUploadMaxMb: row.customUploadMaxMb,
      estimateSolidityPercent: row.estimateSolidityPercent,
      estimateSpreadPercent: row.estimateSpreadPercent,
    },
  };
}
