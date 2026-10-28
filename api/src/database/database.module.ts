import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/** Imported explicitly by each feature module that needs data access (not global). */
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
