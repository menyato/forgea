import { BadRequestException, Injectable } from '@nestjs/common';
import { estimatePrint, priceRange } from '@forgea/pricing';
import type { RequestEstimate } from '@forgea/types';
import { PricingService } from '../pricing/pricing.service.js';
import { StoreSettingsService } from '../store-settings/store-settings.service.js';
import {
  ModelOptimizer,
  ModelRefusedError,
} from '../uploads/model-optimizer.js';
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
    private readonly optimizer: ModelOptimizer,
  ) {}

  /**
   * A stored file never changes, so each one is measured once (a big STL takes a second and
   * real memory to read); null when it can't be read or is too big to measure.
   */
  private readonly volumes = new Map<string, number | null>();

  private async volumeOf(key: string): Promise<number | null> {
    if (this.volumes.has(key)) return this.volumes.get(key)!;
    // Measured in the 3D worker, off the main thread (a big STL takes real CPU and memory). A
    // refused file is remembered as unmeasurable; a busy queue just gives no estimate now.
    let volume: number | null;
    try {
      volume = await this.optimizer.volume(() => this.uploads.read(key));
    } catch (error) {
      if (!(error instanceof ModelRefusedError)) return null;
      volume = null;
    }
    // Bounded: the oldest measurement goes first.
    if (this.volumes.size >= 500) {
      this.volumes.delete(this.volumes.keys().next().value!);
    }
    this.volumes.set(key, volume);
    return volume;
  }

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
    const volumeMm3 = await this.volumeOf(file.key);
    // An STL we can't read is still a valid request: the studio prices it by hand.
    if (volumeMm3 === null) return null;
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
