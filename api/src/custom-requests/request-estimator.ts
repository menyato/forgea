import { BadRequestException, Injectable } from '@nestjs/common';
import { estimatePrint, priceRange } from '@forgea/pricing';
import type { PrintFile, RequestEstimate } from '@forgea/types';
import { ModelFileInfoService } from '../products/model-file-info.js';
import { PricingService } from '../pricing/pricing.service.js';
import { StoreSettingsService } from '../store-settings/store-settings.service.js';
import {
  ModelOptimizer,
  ModelRefusedError,
} from '../uploads/model-optimizer.js';
import { UploadsService } from '../uploads/uploads.service.js';
import { CustomRequestsRepository } from './custom-requests.repository.js';

/**
 * The instant price for a customer's 3D model. The server measures the stored file itself
 * (never numbers from the browser) and prices it with the shop's own cost settings, material
 * and the owner's estimate rules. An STL or a 3MF never sliced gets a range; a sliced 3MF (the
 * slicer's own grams and time) an exact price. Other files are quoted by hand.
 */
@Injectable()
export class RequestEstimator {
  constructor(
    private readonly uploads: UploadsService,
    private readonly pricing: PricingService,
    private readonly settings: StoreSettingsService,
    private readonly requests: CustomRequestsRepository,
    private readonly optimizer: ModelOptimizer,
    private readonly files: ModelFileInfoService,
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
    return (await this.assess(file, materialId, quantity)).estimate;
  }

  /** The estimate, and for a 3MF what one piece takes (kept with the request, for stock). */
  async assess(
    file: { key: string; mimeType: string },
    materialId: string | null,
    quantity: number,
  ): Promise<{
    estimate: RequestEstimate | null;
    printFile: PrintFile | null;
  }> {
    if (file.mimeType === 'model/3mf') {
      return this.threeMf(file.key, materialId, quantity);
    }
    return {
      estimate: await this.stl(file, materialId, quantity),
      printFile: null,
    };
  }

  private async threeMf(
    key: string,
    materialId: string | null,
    quantity: number,
  ): Promise<{
    estimate: RequestEstimate | null;
    printFile: PrintFile | null;
  }> {
    const material = await this.requests.materialFor(materialId);
    if (!material) {
      throw new BadRequestException('That material is not available');
    }
    const { requests: rules } = await this.settings.get();
    let printFile: PrintFile;
    try {
      printFile = await this.files.printFile(
        key,
        material.id,
        rules.estimateSolidityPercent,
      );
    } catch (error) {
      // A 3MF we can't read is still a valid request: the studio prices it by hand.
      if (error instanceof BadRequestException) {
        return { estimate: null, printFile: null };
      }
      throw error;
    }
    const { unitPrice } = await this.pricing.unitPrice({
      grams: printFile.grams,
      printHours: printFile.printHours,
      pricePerGram: material.pricePerGram.toString(),
    });
    const cents = Math.round(Number(unitPrice) * 100) * quantity;
    const total = (cents / 100).toFixed(2);
    return {
      estimate: {
        // The slicer's own numbers: the price itself, no range.
        ...(printFile.sliced
          ? { low: total, high: total }
          : priceRange(total, rules.estimateSpreadPercent)),
        exact: printFile.sliced,
        grams: printFile.grams,
        printHours: printFile.printHours,
        material: { code: material.code, name: material.name },
      },
      printFile,
    };
  }

  private async stl(
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
      exact: false,
      grams: print.grams,
      printHours: print.printHours,
      material: { code: material.code, name: material.name },
    };
  }
}
