import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { UploadsService } from '../uploads/uploads.service.js';

/** A file attached to nothing for this long is deleted. */
const KEEP_UNATTACHED_MS = 24 * 60 * 60 * 1000;
const EVERY_MS = 60 * 60 * 1000;
const BATCH = 200;

/**
 * Every hour, deletes request files that were uploaded but never attached to a request (or a
 * design preview) within a day: otherwise anyone could fill the disk with files nobody uses.
 */
@Injectable()
export class UnusedFilesCleaner
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(UnusedFilesCleaner.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.run().catch((error: unknown) =>
        this.logger.error(`Clean-up failed: ${(error as Error).message}`),
      );
    }, EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /** One pass; returns how many files were deleted. */
  async run(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - KEEP_UNATTACHED_MS);
    let removed = 0;
    for (;;) {
      const unused = await this.prisma.$queryRaw<
        { id: string; storageKey: string }[]
      >`
        SELECT u.id, u."storageKey" FROM uploads u
        WHERE u.purpose = 'CUSTOM_REQUEST_FILE' AND u.status = 'CLEAN'
          AND u."createdAt" < ${before}
          AND NOT EXISTS (
            SELECT 1 FROM custom_requests r
            WHERE r."fileKey" = u."storageKey" OR r."designPreviewKey" = u."storageKey"
          )
        ORDER BY u."createdAt"
        LIMIT ${BATCH}`;
      for (const upload of unused) {
        await this.uploads.discard(
          upload,
          'Removed: never attached to a request',
        );
      }
      removed += unused.length;
      if (unused.length < BATCH) return removed;
    }
  }
}
