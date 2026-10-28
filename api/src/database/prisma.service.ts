import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import type { EnvironmentVariables } from '../config/environment.js';

/**
 * The single Prisma client for the process. Feature modules never construct their own;
 * they inject this through DatabaseModule.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
        // The adapter sends timestamps as UTC wall-clock values without an offset, which
        // Postgres reads in the session time zone. Pin the session to UTC so a server set to
        // e.g. Asia/Beirut doesn't shift every timestamp (expiry, rates, audit) by hours.
        options: '-c TimeZone=UTC',
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
