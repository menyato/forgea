import { BadRequestException, Injectable } from '@nestjs/common';
import type { UploadedFile } from '@forgea/types';
import { UploadPurpose, UploadStatus } from '../generated/prisma/enums.js';
import { StoreSettingsService } from '../store-settings/store-settings.service.js';
import { UploadsService } from '../uploads/uploads.service.js';

const MB = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Files one customer may send in 24 hours (every request together). */
const DAILY_ALLOWANCE_MB = 500;

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

  /** Each customer's uploads in progress, in order (one API per environment). */
  private readonly queues = new Map<string, Promise<unknown>>();

  private oneAtATime<T>(userId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(userId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    const settled = next.catch(() => undefined);
    this.queues.set(userId, settled);
    void settled.then(() => {
      if (this.queues.get(userId) === settled) this.queues.delete(userId);
    });
    return next;
  }

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
    // A daily allowance per customer, so nobody can fill the server's disk. One upload per
    // customer at a time, so files sent together can't all pass the check before any is counted.
    return this.oneAtATime(userId, () => this.withinAllowance(file, userId));
  }

  private async withinAllowance(
    file: Express.Multer.File,
    userId: string,
  ): Promise<UploadedFile> {
    const today = await this.uploads.bytesUploadedSince(
      userId,
      UploadPurpose.CUSTOM_REQUEST_FILE,
      new Date(Date.now() - DAY_MS),
    );
    if (today + file.size > DAILY_ALLOWANCE_MB * MB) {
      throw new BadRequestException(
        `You have sent ${DAILY_ALLOWANCE_MB} MB of files today. Try again tomorrow, or send us a link on WhatsApp.`,
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
