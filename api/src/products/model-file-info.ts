import { BadRequestException, Injectable } from '@nestjs/common';
import { estimatePrint, PricingError } from '@forgea/pricing';
import type { ModelFileInfo } from '@forgea/types';
import type { ModelInfoDto } from '@forgea/validation';
import { Prisma } from '../generated/prisma/client.js';
import { UploadPurpose } from '../generated/prisma/enums.js';
import {
  ModelOptimizer,
  ModelRefusedError,
} from '../uploads/model-optimizer.js';
import type { ThreeMfInfo } from '../uploads/three-mf.js';
import { UploadsService } from '../uploads/uploads.service.js';
import { ProductsRepository } from './products.repository.js';

/**
 * What a product's 3MF says about printing it, for the dashboard to fill the product in: its
 * size, and the grams of each colour and the print time. A sliced Bambu Studio file gives the
 * slicer's own numbers; any other is estimated from its volume in the chosen material, like an
 * STL. Read in the 3D worker, never on the main thread; a stored file never changes, so each
 * is read once.
 */
@Injectable()
export class ModelFileInfoService {
  private readonly cache = new Map<string, ThreeMfInfo>();

  constructor(
    private readonly uploads: UploadsService,
    private readonly optimizer: ModelOptimizer,
    private readonly products: ProductsRepository,
  ) {}

  async info(dto: ModelInfoDto): Promise<ModelFileInfo> {
    if (!dto.key.endsWith('.3mf')) {
      throw new BadRequestException('Only a 3MF file carries its colours');
    }
    await this.uploads.requireClean([dto.key], UploadPurpose.PRODUCT_MODEL);
    const material = await this.products.material(dto.materialId);
    if (!material) throw new BadRequestException('Choose a material');
    const file = await this.read(dto.key);
    const swatches = await this.products.swatches();

    const sliced = file.colours.some((c) => c.grams !== null);
    let grams: Prisma.Decimal;
    let printHours: string;
    let byColour: Prisma.Decimal[];
    if (sliced && file.printSeconds !== null) {
      byColour = file.colours.map((c) => new Prisma.Decimal(c.grams ?? 0));
      grams = byColour.reduce((n, g) => n.plus(g), new Prisma.Decimal(0));
      printHours = new Prisma.Decimal(file.printSeconds)
        .div(3600)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_UP)
        .toFixed(2);
    } else {
      const volume = file.colours.reduce((n, c) => n + c.volumeMm3, 0);
      let estimate;
      try {
        estimate = estimatePrint({
          volumeMm3: volume.toFixed(0),
          densityGPerCm3: material.densityGPerCm3.toString(),
          solidityPercent: dto.solidityPercent,
          gramsPerHour: material.gramsPerHour.toString(),
        });
      } catch (error) {
        if (error instanceof PricingError)
          throw new BadRequestException(error.message);
        throw error;
      }
      grams = new Prisma.Decimal(estimate.grams);
      printHours = estimate.printHours;
      byColour = file.colours.map((c) =>
        volume > 0
          ? grams.times(c.volumeMm3).div(volume)
          : new Prisma.Decimal(0),
      );
    }
    const colours = file.colours
      .map((c, i) => ({
        hex: c.hex,
        type: c.type,
        grams: byColour[i]!.toDecimalPlaces(2, Prisma.Decimal.ROUND_UP),
        suggested: closest(c.hex, swatches),
      }))
      .filter((c) => c.grams.gt(0));
    return {
      size: {
        x: cm(file.sizeMm[0]),
        y: cm(file.sizeMm[1]),
        z: cm(file.sizeMm[2]),
      },
      sliced,
      // The colours, rounded up, are what the product takes in all.
      grams: colours
        .reduce((n, c) => n.plus(c.grams), new Prisma.Decimal(0))
        .toFixed(2),
      printHours,
      colours: colours.map((c) => ({ ...c, grams: c.grams.toFixed(2) })),
    };
  }

  private async read(key: string): Promise<ThreeMfInfo> {
    const known = this.cache.get(key);
    if (known) return known;
    let info: ThreeMfInfo;
    try {
      info = await this.optimizer.threeMfInfo(() => this.uploads.read(key));
    } catch (error) {
      if (error instanceof ModelRefusedError) {
        throw new BadRequestException(
          `This 3MF can't be read: ${error.message}`,
        );
      }
      throw error;
    }
    // Bounded: the oldest goes first.
    if (this.cache.size >= 200) {
      this.cache.delete(this.cache.keys().next().value!);
    }
    this.cache.set(key, info);
    return info;
  }
}

/** Millimetres as the catalog's cm (one decimal, at least 0.1). */
const cm = (mm: number) => Math.max(0.1, Math.round(mm) / 10).toFixed(1);

/** The shop's colour nearest to a file's (by how far apart they look), if any is close. */
function closest(
  hex: string,
  swatches: readonly { label: string; swatchHex: string }[],
): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  const [r, g, b] = rgb(hex);
  for (const s of swatches) {
    const [sr, sg, sb] = rgb(s.swatchHex);
    // "Redmean": a cheap distance that follows the eye better than plain RGB.
    const mean = (r + sr) / 2;
    const d = Math.sqrt(
      (2 + mean / 256) * (r - sr) ** 2 +
        4 * (g - sg) ** 2 +
        (2 + (255 - mean) / 256) * (b - sb) ** 2,
    );
    if (d < bestDistance) [best, bestDistance] = [s.label, d];
  }
  // Further than this, guessing would be wrong more often than right: the owner chooses.
  return bestDistance <= 150 ? best : null;
}

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
