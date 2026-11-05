import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PrinterView } from '@forgea/types';
import type { SavePrinterDto } from '@forgea/validation';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';

/** The studio's printers: every print job runs on one, which gives its electricity and wear. */
@Injectable()
export class PrintersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<PrinterView[]> {
    const rows = await this.prisma.printer.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { jobs: true } } },
    });
    return rows.map(toView);
  }

  async one(id: string): Promise<PrinterView> {
    const p = await this.prisma.printer.findUnique({
      where: { id },
      include: { _count: { select: { jobs: true } } },
    });
    if (!p) throw new NotFoundException('Printer not found');
    return toView(p);
  }

  async save(id: string | null, dto: SavePrinterDto): Promise<PrinterView> {
    if ((dto.priceUsd === undefined) !== (dto.lifeHours === undefined))
      throw new BadRequestException(
        'Give both its price and the hours it should last, or neither',
      );
    const data = {
      name: dto.name,
      watts: dto.watts,
      priceUsd: dto.priceUsd ?? null,
      lifeHours: dto.lifeHours ?? null,
      active: dto.active,
      notes: dto.notes ?? null,
    };
    try {
      const p = id
        ? await this.prisma.printer.update({ where: { id }, data })
        : await this.prisma.printer.create({ data });
      return this.one(p.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002')
          throw new ConflictException(
            'A printer with this name already exists',
          );
        if (error.code === 'P2025')
          throw new NotFoundException('Printer not found');
      }
      throw error;
    }
  }
}

function toView(
  p: Prisma.PrinterGetPayload<{
    include: { _count: { select: { jobs: true } } };
  }>,
): PrinterView {
  return {
    id: p.id,
    name: p.name,
    watts: p.watts,
    priceUsd: p.priceUsd?.toFixed(2) ?? null,
    lifeHours: p.lifeHours,
    wearPerHour:
      p.priceUsd && p.lifeHours ? p.priceUsd.div(p.lifeHours).toFixed(4) : null,
    active: p.active,
    notes: p.notes,
    jobs: p._count.jobs,
  };
}
