import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Currency, ExchangeRate } from '../generated/prisma/client.js';

export type CurrencyWithRate = Currency & { rate: ExchangeRate | null };

@Injectable()
export class CurrenciesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Active currencies, each with the rate in force at `at` (null for the base currency). */
  async activeWithRates(at: Date): Promise<CurrencyWithRate[]> {
    const currencies = await this.prisma.currency.findMany({
      where: { active: true },
      orderBy: [{ isBase: 'desc' }, { code: 'asc' }],
      include: {
        rates: {
          where: { effectiveFrom: { lte: at } },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
    });
    return currencies.map(({ rates, ...c }) => ({
      ...c,
      rate: rates[0] ?? null,
    }));
  }

  findByCode(code: string): Promise<Currency | null> {
    return this.prisma.currency.findUnique({ where: { code } });
  }

  /** The latest rates first, with who set them. */
  history(code: string, take: number) {
    return this.prisma.exchangeRate.findMany({
      where: { currencyCode: code },
      orderBy: { effectiveFrom: 'desc' },
      take,
      include: { setBy: { select: { email: true } } },
    });
  }

  /** A new currency and its first rate, together. */
  create(
    currency: {
      code: string;
      name: string;
      decimals: number;
      roundingStep: string;
    },
    rate: { rate: string; setByUserId: string },
  ): Promise<Currency> {
    return this.prisma.currency.create({
      data: { ...currency, rates: { create: rate } },
    });
  }

  /** Appends a rate; history is never rewritten. */
  addRate(data: {
    currencyCode: string;
    rate: string;
    setByUserId: string;
  }): Promise<ExchangeRate> {
    return this.prisma.exchangeRate.create({ data });
  }
}
