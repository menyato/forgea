import { BadRequestException, Injectable } from '@nestjs/common';
import type { PrintFile, QuotationPrintFileView } from '@forgea/types';
import { PrismaService } from '../database/prisma.service.js';
import { UploadPurpose } from '../generated/prisma/enums.js';
import { PricingService } from '../pricing/pricing.service.js';
import { ModelFileInfoService } from '../products/model-file-info.js';
import { StoreSettingsService } from '../store-settings/store-settings.service.js';
import { UploadsService } from '../uploads/uploads.service.js';

/**
 * A quotation line made from a 3MF the team uploaded: what one piece takes (read by the API
 * from the file, never numbers from the browser), its size, and what it sells at in the shop's
 * pricing. The line keeps the file and its grams per colour; its order takes them from stock.
 */
@Injectable()
export class QuotationPrintFiles {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly files: ModelFileInfoService,
    private readonly pricing: PricingService,
    private readonly store: StoreSettingsService,
  ) {}

  /** The file read for the dashboard: the line's numbers and a price to start from. */
  async read(
    key: string,
    materialId: string | undefined,
  ): Promise<QuotationPrintFileView> {
    const materials = await this.prisma.material.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true, pricePerGram: true },
      orderBy: { pricePerGram: 'asc' },
    });
    const material = materialId
      ? materials.find((m) => m.id === materialId)
      : materials[0];
    if (!material) throw new BadRequestException('Choose a material');
    await this.uploads.requireClean([key], UploadPurpose.QUOTATION_FILE);
    const solidity = await this.solidity();
    const [info, printFile] = await Promise.all([
      this.files.measure(key, material.id, solidity),
      this.files.printFile(key, material.id, solidity),
    ]);
    requireSliced(key, printFile);
    const unitPrice = await this.pricing.shopPrice({
      grams: printFile.grams,
      printHours: printFile.printHours,
      pricePerGram: material.pricePerGram.toString(),
      // The slicer's grams hold its purge, prime tower and supports already.
      wasteIncluded: printFile.sliced,
    });
    return {
      printFile,
      size: info.size,
      unitPrice,
      materials: [
        material,
        ...materials.filter((m) => m.id !== material.id),
      ].map((m) => ({ id: m.id, code: m.code, name: m.name })),
    };
  }

  /** What a saved line keeps: read again from the file, so it is always the file's own. */
  async forLine(key: string, materialId: string): Promise<PrintFile> {
    await this.uploads.requireClean([key], UploadPurpose.QUOTATION_FILE);
    const printFile = await this.files.printFile(
      key,
      materialId,
      await this.solidity(),
    );
    requireSliced(key, printFile);
    return printFile;
  }

  /** Files never sliced are estimated as the shop estimates customers' files. */
  private async solidity(): Promise<number> {
    return (await this.store.get()).requests.estimateSolidityPercent;
  }
}

/**
 * A 3MF prices a line only once sliced: then its grams and time are the slicer's, purge,
 * prime tower and supports included. An STL or GLB is still estimated from its volume.
 */
function requireSliced(key: string, printFile: PrintFile): void {
  if (key.endsWith('.3mf') && !printFile.sliced)
    throw new BadRequestException(
      "This 3MF isn't sliced. In Bambu Studio, slice it and choose File → Export → Export plate sliced file, then upload that .gcode.3mf",
    );
}
