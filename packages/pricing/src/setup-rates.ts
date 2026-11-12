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
  const { wear, power } = hourParts(p);
  return wear.plus(power).round(2, Big.roundHalfUp).toFixed(2);
}

/**
 * A printing cost shared between the printer wearing out and the electricity it draws, as the
 * printer's details share an hour ($4.00 of printer time at $0.10 wear + $0.045 power an hour
 * is $2.76 wear and $1.24 electricity). The two always add up to the cost given.
 */
export function splitPrinterCost(
  p: PrinterCosts,
  machineCost: DecimalInput,
): { wear: string; electricity: string } {
  const { wear, power } = hourParts(p);
  const cost = toBig(machineCost, 'printer cost');
  const hour = wear.plus(power);
  const electricity = hour.eq(0)
    ? new Big(0)
    : cost.times(power).div(hour).round(2, Big.roundHalfUp);
  return {
    wear: cost.minus(electricity).toFixed(2),
    electricity: electricity.toFixed(2),
  };
}

function hourParts(p: PrinterCosts): { wear: Big; power: Big } {
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
  return { wear, power };
}

/**
 * A bill's discount shared across its lines by their price, to the cent: each line's net
 * amount (what it really cost), the last line taking the rounding so they add up to the bill.
 */
export function shareDiscount(
  lineTotals: readonly DecimalInput[],
  discount: DecimalInput,
): string[] {
  const totals = lineTotals.map((t) =>
    requireNonNegative(toBig(t, 'line total'), 'line total'),
  );
  const gross = totals.reduce((n, t) => n.plus(t), new Big(0));
  const off = requireNonNegative(toBig(discount, 'discount'), 'discount');
  if (off.gt(gross))
    throw new PricingError('The discount is more than the bill');
  const net = gross.minus(off);
  let given = new Big(0);
  return totals.map((t, i) => {
    if (i === totals.length - 1) return net.minus(given).toFixed(2);
    const share = gross.eq(0)
      ? new Big(0)
      : t.times(net).div(gross).round(2, Big.roundHalfUp);
    given = given.plus(share);
    return share.toFixed(2);
  });
}
