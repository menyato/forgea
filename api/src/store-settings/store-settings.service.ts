import { deliveryArea } from '@forgea/types';
import { BadRequestException } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { QuotationEmailSettings, StoreSettings } from '@forgea/types';
import type {
  UpdateQuotationEmailDto,
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

  async updateDeliveryAreas(
    areas: string[],
    adminId: string,
  ): Promise<StoreSettings> {
    return toView(
      await this.settings.updateDeliveryAreas(
        areas.map((a) => a.trim()).filter(Boolean),
        adminId,
      ),
    );
  }

  /**
   * The area as the list writes it; 400 when the studio doesn't deliver there (checkout and
   * quotations, so a typed or stale value can never slip through).
   */
  async requireDeliveryArea(city: string | null | undefined): Promise<string> {
    const area = deliveryArea((await this.get()).deliveryAreas, city);
    if (!area)
      throw new BadRequestException('Choose the delivery area from the list');
    return area;
  }

  async updateRequestRules(
    dto: UpdateRequestSettingsDto,
    adminId: string,
  ): Promise<StoreSettings> {
    return toView(await this.settings.updateRequestRules(dto, adminId));
  }

  /** The quotation email's own words (null: the standard wording). Never shown publicly. */
  async quotationEmail(): Promise<QuotationEmailSettings> {
    return toEmail(await this.settings.get());
  }

  async updateQuotationEmail(
    dto: UpdateQuotationEmailDto,
    adminId: string,
  ): Promise<QuotationEmailSettings> {
    // An empty box goes back to the standard wording.
    const own = (v: string | undefined) => (v ? v : null);
    return toEmail(
      await this.settings.updateQuotationEmail(
        {
          quotationEmailSubject: own(dto.subject),
          quotationEmailIntro: own(dto.intro),
          quotationEmailClosing: own(dto.closing),
        },
        adminId,
      ),
    );
  }
}

function toEmail(row: StoreSettingsRow): QuotationEmailSettings {
  return {
    subject: row.quotationEmailSubject,
    intro: row.quotationEmailIntro,
    closing: row.quotationEmailClosing,
  };
}

function toView(row: StoreSettingsRow): StoreSettings {
  return {
    transferPhone: row.transferPhone,
    transferInstructions: row.transferInstructions,
    whatsappPhone: row.whatsappPhone,
    deliveryAreas: row.deliveryAreas,
    requests: {
      quoteValidityDays: row.quoteValidityDays,
      depositRefundable: row.depositRefundable,
      customUploadMaxMb: row.customUploadMaxMb,
      estimateSolidityPercent: row.estimateSolidityPercent,
      estimateSpreadPercent: row.estimateSpreadPercent,
      autoQuoteSlicedFiles: row.autoQuoteSlicedFiles,
    },
  };
}
