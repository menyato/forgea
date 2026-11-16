import { BadRequestException, Injectable } from '@nestjs/common';
import { estimatePrint, PricingError } from '@forgea/pricing';
import type {
  ModelFileInfo,
  PrintFile,
  PrintFilesTotal,
  ProductPrintFileView,
} from '@forgea/types';
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

  /** A product's 3MF (Dashboard → Products). */
  async info(dto: ModelInfoDto): Promise<ModelFileInfo> {
    if (!dto.key.endsWith('.3mf')) {
      throw new BadRequestException('Only a 3MF file carries its colours');
    }
    await this.uploads.requireClean([dto.key], UploadPurpose.PRODUCT_MODEL);
    return this.measure(dto.key, dto.materialId, dto.solidityPercent);
  }

  /**
   * What one piece made from this 3MF takes, kept with a quotation line, a custom request and
   * their orders (for the stock and the print project). Each colour goes by the shop's name
   * for it, else its #rrggbb. The caller checks the file is one the person may use.
   */
  async printFile(
    key: string,
    materialId: string,
    solidityPercent: number,
  ): Promise<PrintFile> {
    const info = await this.measure(key, materialId, solidityPercent);
    return {
      fileKey: key,
      materialId,
      sliced: info.sliced,
      grams: info.grams,
      printHours: info.printHours,
      colours: info.colours.map((c) => ({
        colour: c.suggested ?? c.hex,
        hex: c.hex,
        grams: c.grams,
      })),
    };
  }

  /**
   * Whether these grams and hours are this sliced 3MF's own (to a 20th of a gram and a minute
   * or so): then they hold the slicer's purge, prime tower and supports already. A file that
   * can't be read, or isn't sliced, says no.
   */
  async slicedNumbers(
    key: string | undefined,
    materialId: string,
    grams: string,
    printHours: string,
    /** Its sliced print files: then the numbers are theirs when they are their total. */
    printFileKeys: readonly string[] = [],
  ): Promise<boolean> {
    const same = (file: { grams: string; printHours: string }) =>
      new Prisma.Decimal(file.grams).minus(grams).abs().lte(0.05) &&
      new Prisma.Decimal(file.printHours).minus(printHours).abs().lte(0.02);
    try {
      if (printFileKeys.length > 0)
        return same(
          await this.printFiles(
            printFileKeys.map((k) => ({ key: k, name: 'A print file' })),
            materialId,
          ),
        );
      if (!key?.endsWith('.3mf')) return false;
      const info = await this.measure(key, materialId, 100);
      return info.sliced && same(info);
    } catch (error) {
      if (error instanceof BadRequestException) return false;
      throw error;
    }
  }

  /**
   * What the file's own shapes would take, guessed from their volume whatever its slicer
   * says: the check on numbers a customer's file brings. Null when the file holds no shape
   * to measure, or can't be read.
   */
  async meshEstimate(
    key: string,
    materialId: string,
    solidityPercent: number,
  ): Promise<{ grams: string; printHours: string } | null> {
    const material = await this.products.material(materialId);
    if (!material) return null;
    try {
      const file = await this.read(key);
      const volume = file.colours.reduce((n, c) => n + c.volumeMm3, 0);
      return volume > 0 ? fromVolume(volume, material, solidityPercent) : null;
    } catch (error) {
      if (error instanceof BadRequestException) return null;
      throw error;
    }
  }

  /** The file's size, grams per colour and time, in a material. */
  async measure(
    key: string,
    materialId: string,
    solidityPercent: number,
  ): Promise<ModelFileInfo> {
    const material = await this.products.material(materialId);
    if (!material) throw new BadRequestException('Choose a material');
    const file = await this.read(key);
    const swatches = await this.products.swatches();

    const sliced =
      file.printSeconds !== null && file.colours.some((c) => c.grams !== null);
    let grams: Prisma.Decimal;
    let printHours: string;
    let byColour: Prisma.Decimal[];
    if (sliced) {
      byColour = file.colours.map((c) => new Prisma.Decimal(c.grams ?? 0));
      grams = byColour.reduce((n, g) => n.plus(g), new Prisma.Decimal(0));
      printHours = new Prisma.Decimal(file.printSeconds ?? 0)
        .div(3600)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_UP)
        .toFixed(2);
    } else {
      const volume = file.colours.reduce((n, c) => n + c.volumeMm3, 0);
      const estimate = fromVolume(volume, material, solidityPercent);
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
      setup: file.setup,
    };
  }

  /**
   * A product's sliced print files, read and added up: each one's grams per colour, time and
   * set-up, and what they take together (colours of the same name summed). Every file must be
   * an accepted product upload and sliced: only the slicer knows its purge, tower and supports.
   */
  async printFiles(
    files: readonly { key: string; name: string }[],
    materialId: string,
  ): Promise<PrintFilesTotal> {
    const keys = files.map((f) => f.key);
    if (new Set(keys).size !== keys.length)
      throw new BadRequestException('A print file is listed twice');
    await this.uploads.requireClean(keys, UploadPurpose.PRODUCT_MODEL);
    const views: ProductPrintFileView[] = [];
    for (const f of files) {
      const info = await this.measure(f.key, materialId, 100);
      if (!info.sliced)
        throw new BadRequestException(
          `${f.name} is not sliced. In Bambu Studio, slice it and choose File → Export → Export plate sliced file, then upload that .gcode.3mf`,
        );
      views.push({
        fileKey: f.key,
        name: f.name,
        grams: info.grams,
        printHours: info.printHours,
        colours: info.colours.map((c) => ({
          colour: c.suggested ?? c.hex,
          hex: c.hex,
          type: c.type,
          grams: c.grams,
        })),
        setup: info.setup,
      });
    }
    const byColour = new Map<string, { hex: string; grams: Prisma.Decimal }>();
    for (const c of views.flatMap((v) => v.colours)) {
      const sum = byColour.get(c.colour);
      if (sum) sum.grams = sum.grams.plus(c.grams);
      else
        byColour.set(c.colour, {
          hex: c.hex,
          grams: new Prisma.Decimal(c.grams),
        });
    }
    const total = (pick: (v: ProductPrintFileView) => string) =>
      views.reduce((n, v) => n.plus(pick(v)), new Prisma.Decimal(0)).toFixed(2);
    return {
      files: views,
      grams: total((v) => v.grams),
      printHours: total((v) => v.printHours),
      colours: [...byColour].map(([colour, c]) => ({
        colour,
        hex: c.hex,
        grams: c.grams.toFixed(2),
      })),
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

/** Grams and hours guessed from a volume (400 when the numbers can't make a print). */
function fromVolume(
  volumeMm3: number,
  material: { densityGPerCm3: Prisma.Decimal; gramsPerHour: Prisma.Decimal },
  solidityPercent: number,
) {
  try {
    return estimatePrint({
      volumeMm3: volumeMm3.toFixed(0),
      densityGPerCm3: material.densityGPerCm3.toString(),
      solidityPercent,
      gramsPerHour: material.gramsPerHour.toString(),
    });
  } catch (error) {
    if (error instanceof PricingError)
      throw new BadRequestException(error.message);
    throw error;
  }
}
