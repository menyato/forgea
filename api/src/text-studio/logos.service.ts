import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Region } from '@forgea/text3d';
import type { CustomerLogoView, LogoDetail, LogoView } from '@forgea/types';
import type { UpdateLogoDto } from '@forgea/validation';
import type { Logo } from '../generated/prisma/client.js';
import { Prisma } from '../generated/prisma/client.js';
import { LogosRepository } from './logos.repository.js';
import { TextShaper } from './text-shaper.js';

/** The most an SVG may weigh (a logo's drawing; a photo saved as SVG is refused). */
export const LOGO_SVG_MAX_BYTES = 1024 * 1024;

/** A customer's logo: their SVG, or their picture as their browser traced it. */
export const CUSTOMER_LOGO_MAX_BYTES = 512 * 1024;

/** The studio's logos (Dashboard → Logos), added to products' text and logo slots. */
@Injectable()
export class LogosService {
  constructor(
    private readonly logos: LogosRepository,
    private readonly shaper: TextShaper,
  ) {}

  async list(): Promise<LogoView[]> {
    return (await this.logos.all()).map(toView);
  }

  /**
   * A logo from an SVG drawing: read in the worker into print outlines (never on the main
   * thread), and only those are kept: the file itself is neither stored nor served.
   */
  async create(name: string, file: Buffer | undefined): Promise<LogoView> {
    const read = await this.read(file, LOGO_SVG_MAX_BYTES, '1 MB');
    const clean = name.trim().slice(0, 60);
    if (await this.logos.findByName(clean))
      throw new ConflictException(`There is already a logo called ${clean}`);
    return toView(
      await this.logos.create({
        name: clean,
        outline: read.outline as unknown as Prisma.InputJsonValue,
        points: read.points,
        sortOrder: await this.logos.count(),
      }),
    );
  }

  /**
   * A customer's own logo (anyone may bring one: the shop's visitors design before they have
   * an account): read like the studio's, only the outline kept, its id used in their design.
   */
  async createForCustomer(file: Buffer | undefined): Promise<CustomerLogoView> {
    const read = await this.read(file, CUSTOMER_LOGO_MAX_BYTES, '512 KB');
    const logo = await this.logos.createCustomer({
      outline: read.outline as unknown as Prisma.InputJsonValue,
      points: read.points,
    });
    return { id: logo.id, outline: read.outline, points: read.points };
  }

  /** An SVG read in the worker into print outlines (never on the main thread). */
  private async read(
    file: Buffer | undefined,
    maxBytes: number,
    maxLabel: string,
  ): Promise<{ outline: Region[]; points: number }> {
    if (!file || file.length === 0)
      throw new BadRequestException('Choose an SVG file');
    if (file.length > maxBytes)
      throw new BadRequestException(`The SVG is larger than ${maxLabel}`);
    const svg = new TextDecoder('utf-8', { fatal: false }).decode(file);
    if (!/<svg[\s>]/i.test(svg))
      throw new BadRequestException('This is not an SVG drawing');
    const read = await this.shaper.logo(svg);
    if ('problem' in read) throw new BadRequestException(read.problem);
    return read;
  }

  /** Renamed, reordered or switched off (never deleted: products and orders use it). */
  async update(id: string, dto: UpdateLogoDto): Promise<LogoView> {
    try {
      return toView(await this.logos.update(id, dto));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025')
          throw new NotFoundException('Logo not found');
        if (error.code === 'P2002')
          throw new ConflictException(
            `There is already a logo called ${dto.name}`,
          );
      }
      throw error;
    }
  }

  async one(id: string): Promise<LogoDetail> {
    const [logo] = await this.logos.byIds([id]);
    if (!logo) throw new NotFoundException('Logo not found');
    return { ...toView(logo), outline: logo.outline as unknown as Region[] };
  }

  /** The outlines of these logos, the studio's or customers' own, by id, for building pieces. */
  async outlines(ids: readonly string[]): Promise<[string, Region[]][]> {
    const unique = [...new Set(ids)];
    const [studio, customers] = await Promise.all([
      this.logos.byIds(unique),
      this.logos.customerByIds(unique),
    ]);
    return [...studio, ...customers].map((l) => [
      l.id,
      l.outline as unknown as Region[],
    ]);
  }

  /** Which of these ids are customers' own logos. */
  async customerLogoIds(ids: readonly string[]): Promise<Set<string>> {
    return new Set(
      (await this.logos.customerByIds([...new Set(ids)])).map((l) => l.id),
    );
  }

  /** These logos' names and whether they are offered. */
  async named(ids: readonly string[]): Promise<Map<string, Logo>> {
    return new Map(
      (await this.logos.byIds([...new Set(ids)])).map((l) => [l.id, l]),
    );
  }
}

function toView(l: Logo): LogoView {
  return {
    id: l.id,
    name: l.name,
    points: l.points,
    active: l.active,
    sortOrder: l.sortOrder,
  };
}
