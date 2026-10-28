import { BadRequestException, Injectable } from '@nestjs/common';
import {
  estimatePrint,
  meshVolume,
  PricingError,
  priceRange,
  stlPositions,
} from '@forgea/pricing';
import type { RequestEstimate } from '@forgea/types';
import { PricingService } from '../pricing/pricing.service.js';
import { StoreSettingsService } from '../store-settings/store-settings.service.js';
import { UploadsService } from '../uploads/uploads.service.js';
import { CustomRequestsRepository } from './custom-requests.repository.js';

/**
 * The instant price range for a customer's 3D model. The server measures the stored file
 * itself (never numbers from the browser) and prices it with the shop's own cost settings,
 * material and the owner's estimate rules. Only STL can be measured; other files are
 * quoted by hand.
 */
@Injectable()
export class RequestEstimator {
  constructor(
    private readonly uploads: UploadsService,
    private readonly pricing: PricingService,
    private readonly settings: StoreSettingsService,
    private readonly requests: CustomRequestsRepository,
  ) {}

  async estimate(
    file: { key: string; mimeType: string },
    materialId: string | null,
    quantity: number,
  ): Promise<RequestEstimate | null> {
    if (file.mimeType !== 'model/stl') return null;
    const material = await this.requests.materialFor(materialId);
    if (!material) {
      throw new BadRequestException('That material is not available');
    }
    let volumeMm3: number;
    try {
      volumeMm3 = meshVolume(stlPositions(await this.uploads.read(file.key)));
    } catch (error) {
      // An STL we can't read is still a valid request: the studio prices it by hand.
      if (error instanceof PricingError) return null;
      throw error;
    }
    const { requests: rules } = await this.settings.get();
    const print = estimatePrint({
      volumeMm3,
      densityGPerCm3: material.densityGPerCm3.toString(),
      solidityPercent: rules.estimateSolidityPercent,
      gramsPerHour: material.gramsPerHour.toString(),
    });
    const { unitPrice } = await this.pricing.unitPrice({
      grams: print.grams,
      printHours: print.printHours,
      pricePerGram: material.pricePerGram.toString(),
    });
    // Whole cents, so multiplying by the quantity never drifts.
    const cents = Math.round(Number(unitPrice) * 100) * quantity;
    return {
      ...priceRange((cents / 100).toFixed(2), rules.estimateSpreadPercent),
      grams: print.grams,
      printHours: print.printHours,
      material: { code: material.code, name: material.name },
    };
  }
}
