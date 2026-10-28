import { BadRequestException, Injectable } from '@nestjs/common';
import type { UploadedFile } from '@forgea/types';
import { UploadPurpose, UploadStatus } from '../generated/prisma/enums.js';
import { StoreSettingsService } from '../store-settings/store-settings.service.js';
import { UploadsService } from '../uploads/uploads.service.js';

const MB = 1024 * 1024;

/**
 * Files on a request: the customer's attachment (checked against the owner's size limit, a
 * dashboard setting) and the studio's design preview. Both go through the same quarantine
 * and inspection as every upload.
 */
@Injectable()
export class CustomerFilesService {
  constructor(
    private readonly uploads: UploadsService,
    private readonly settings: StoreSettingsService,
  ) {}

  async receive(
    file: Express.Multer.File | undefined,
    userId: string,
  ): Promise<UploadedFile> {
    if (!file) throw new BadRequestException('Choose a file to upload');
    const { requests } = await this.settings.get();
    if (file.size > requests.customUploadMaxMb * MB) {
      throw new BadRequestException(
        `Files can be up to ${requests.customUploadMaxMb} MB. For bigger ones, send us a link on WhatsApp.`,
      );
    }
    return this.store(file, userId);
  }

  /** A design preview from the studio: only the upload ceiling applies. */
  receiveFromStudio(
    file: Express.Multer.File | undefined,
    userId: string,
  ): Promise<UploadedFile> {
    if (!file) throw new BadRequestException('Choose a file to upload');
    return this.store(file, userId);
  }

  private async store(
    file: Express.Multer.File,
    userId: string,
  ): Promise<UploadedFile> {
    const upload = await this.uploads.receive(
      { data: file.buffer, originalName: file.originalname },
      UploadPurpose.CUSTOM_REQUEST_FILE,
      userId,
    );
    if (upload.status !== UploadStatus.CLEAN) {
      throw new BadRequestException(upload.rejectionReason ?? 'File refused');
    }
    return {
      key: upload.storageKey,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
      originalName: upload.originalName,
    };
  }
}
