import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Once a day, deletes sign-in sessions that expired more than a day ago: every token renewal
 * adds a row, and an expired one can never be used again. Revoked sessions that have not
 * expired are kept: they are how a reused (stolen) refresh token is recognised.
 */
@Injectable()
export class ExpiredSessionsCleaner
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ExpiredSessionsCleaner.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.run().catch((error: unknown) =>
        this.logger.error(`Clean-up failed: ${(error as Error).message}`),
      );
    }, DAY_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /** One pass; returns how many sessions were deleted. */
  async run(now = new Date()): Promise<number> {
    const { count } = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - DAY_MS) } },
    });
    return count;
  }
}
