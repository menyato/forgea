import { Matches } from 'class-validator';
import { POSITIVE_RATE } from './constants.js';

/** Admin sets a new exchange rate: units of this currency per 1 unit of the base currency. */
export class SetExchangeRateDto {
  @Matches(POSITIVE_RATE, { message: 'Enter a positive rate, e.g. 89500' })
  rate!: string;
}
