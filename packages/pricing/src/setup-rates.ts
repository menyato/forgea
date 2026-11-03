import Big from 'big.js';
import { PricingError } from './errors.js';
import { type DecimalInput, requireNonNegative, toBig } from './money.js';

/**
 * What a gram of filament costs, from one reel as bought: its price ÷ its weight
 * ($22 for a 1000 g reel = $0.0220 a gram). Four decimals, as the materials table keeps it.
 */
export function pricePerGramFromReel(
  reelPrice: DecimalInput,
  reelGrams: DecimalInput,
): string {
  const price = requireNonNegative(
    toBig(reelPrice, 'reel price'),
    'reel price',
  );
  const grams = toBig(reelGrams, 'reel weight');
  if (grams.lte(0)) throw new PricingError('reel weight must be above 0');
  return price.div(grams).round(4, Big.roundHalfUp).toFixed(4);
}

export interface PrinterCosts {
  /** What the printer cost (USD). */
  printerPrice: DecimalInput;
  /** How many printing hours it is expected to last before it needs replacing. */
  lifeHours: DecimalInput;
  /** Its average power draw while printing (watts). */
  watts: DecimalInput;
  /** What a kilowatt-hour of electricity costs (USD). */
  electricityPerKwh: DecimalInput;
}

/**
 * What an hour of printing costs: the printer's price spread over its life, plus the
 * electricity it draws ($600 over 6000 h = $0.10, + 150 W × $0.30/kWh = $0.045 → $0.15 an hour).
 */
export function printerHourlyRate(p: PrinterCosts): string {
  const life = toBig(p.lifeHours, 'printer life');
  if (life.lte(0)) throw new PricingError('printer life must be above 0 hours');
  const wear = requireNonNegative(
    toBig(p.printerPrice, 'printer price'),
    'printer price',
  ).div(life);
  const power = requireNonNegative(toBig(p.watts, 'watts'), 'watts')
    .div(1000)
    .times(
      requireNonNegative(
        toBig(p.electricityPerKwh, 'electricity price'),
        'electricity price',
      ),
    );
  return wear.plus(power).round(2, Big.roundHalfUp).toFixed(2);
}
