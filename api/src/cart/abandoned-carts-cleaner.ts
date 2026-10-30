import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A visitor's cart nobody touched for this long is gone (their cookie lasts as long). */
const KEEP_GUEST_CART_DAYS = 30;

/**
 * Once a day, deletes visitors' carts (no account) untouched for 30 days, with their lines:
 * every new visitor who adds something makes one, bots included. Customers' carts stay.
 */
@Injectable()
export class AbandonedCartsCleaner
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(AbandonedCartsCleaner.name);
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

  /** One pass; returns how many carts were deleted. */
  async run(now = new Date()): Promise<number> {
    const { count } = await this.prisma.cart.deleteMany({
      where: {
        userId: null,
        updatedAt: {
          lt: new Date(now.getTime() - KEEP_GUEST_CART_DAYS * DAY_MS),
        },
      },
    });
    return count;
  }
}
