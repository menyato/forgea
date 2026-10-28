import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

export interface HealthStatus {
  status: 'ok' | 'error';
  database?: 'up' | 'down';
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: the process is up. Deliberately ignores the database. */
  live(): HealthStatus {
    return { status: 'ok' };
  }

  /** Readiness: the process can reach the database. */
  async ready(): Promise<HealthStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch {
      return { status: 'error', database: 'down' };
    }
  }
}
