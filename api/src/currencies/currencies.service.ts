import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CurrencyConverter } from '@forgea/pricing';
import type { CurrencyQuote, ExchangeRateEntry } from '@forgea/types';
import {
  CurrenciesRepository,
  type CurrencyWithRate,
} from './currencies.repository.js';

/**
 * The admin-controlled currencies and rates. Orders (Phase 5), invoices and accounting
 * (Phase 11) get their converter here, so every part of the system uses the same rate.
 */
@Injectable()
export class CurrenciesService {
  constructor(private readonly currencies: CurrenciesRepository) {}

  async list(at = new Date()): Promise<CurrencyQuote[]> {
    return (await this.currencies.activeWithRates(at)).flatMap((c) => {
      const quote = toQuote(c);
      // A non-base currency with no rate yet can't be offered.
      return quote ? [quote] : [];
    });
  }

  /** A converter from the base currency into `code`, at the rate in force at `at`. */
  async converterFor(
    code: string,
    at = new Date(),
  ): Promise<CurrencyConverter> {
    const quote = (await this.list(at)).find((c) => c.code === code);
    if (!quote)
      throw new BadRequestException(`${code} is not an accepted currency`);
    return new CurrencyConverter(quote, quote.rate);
  }

  /** The last rates set for a currency, newest first. */
  async history(code: string): Promise<ExchangeRateEntry[]> {
    if (!(await this.currencies.findByCode(code)))
      throw new NotFoundException(`Unknown currency ${code}`);
    return (await this.currencies.history(code, 20)).map((r) => ({
      rate: r.rate.toString(),
      effectiveFrom: r.effectiveFrom.toISOString(),
      setBy: r.setBy?.email ?? null,
    }));
  }

  async setRate(
    code: string,
    rate: string,
    adminId: string,
  ): Promise<CurrencyQuote> {
    const currency = await this.currencies.findByCode(code);
    if (!currency) throw new NotFoundException(`Unknown currency ${code}`);
    if (currency.isBase) {
      throw new BadRequestException(
        `${code} is the base currency; its rate is always 1`,
      );
    }
    await this.currencies.addRate({
      currencyCode: code,
      rate,
      setByUserId: adminId,
    });
    const updated = (await this.list()).find((c) => c.code === code);
    if (!updated)
      throw new InternalServerErrorException('Rate was not recorded');
    return updated;
  }
}

function toQuote(c: CurrencyWithRate): CurrencyQuote | null {
  if (!c.isBase && !c.rate) return null;
  return {
    code: c.code,
    name: c.name,
    decimals: c.decimals,
    roundingStep: c.roundingStep.toString(),
    isBase: c.isBase,
    rate: c.isBase ? '1' : c.rate!.rate.toString(),
    rateEffectiveFrom: c.rate?.effectiveFrom.toISOString() ?? null,
  };
}
