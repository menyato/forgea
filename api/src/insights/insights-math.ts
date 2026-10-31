import { type Amount, splitTaxIncluded } from '../accounting/ledger-math.js';
import { Prisma } from '../generated/prisma/client.js';

const D = (v: Amount) => new Prisma.Decimal(v);

/** An invoiced order line (signed), with its estimated cost per unit when it has one. */
export interface CostedLine {
  bucket: string;
  productId: string | null;
  units: number;
  /** Tax included. */
  gross: Prisma.Decimal;
  unitCost: Prisma.Decimal | null;
}

interface ProductFigures {
  units: number;
  /** Taxes excluded. */
  revenue: Prisma.Decimal;
  /** Null when part of it can't be estimated. */
  cost: Prisma.Decimal | null;
}

export interface LineFigures {
  cost: Prisma.Decimal;
  /** Revenue (taxes excluded) of lines without a cost estimate. */
  uncosted: Prisma.Decimal;
  costByBucket: Map<string, Prisma.Decimal>;
  byProduct: Map<string, ProductFigures>;
  /** Lines without a catalog product. */
  custom: { units: number; revenue: Prisma.Decimal };
}

/**
 * Adds up invoiced lines in cents (Decimal, never floats): the estimated production cost
 * (units × cost per unit), per chart bar and per product, and the revenue of each product with
 * the tax taken out at today's rate (the books keep the totals; this splits them by product).
 */
export function lineFigures(
  lines: readonly CostedLine[],
  taxRatePercent: Prisma.Decimal | null,
): LineFigures {
  const out: LineFigures = {
    cost: D(0),
    uncosted: D(0),
    costByBucket: new Map(),
    byProduct: new Map(),
    custom: { units: 0, revenue: D(0) },
  };
  for (const l of lines) {
    const revenue = splitTaxIncluded(l.gross, taxRatePercent).base;
    const cost = l.unitCost ? l.unitCost.times(l.units) : null;
    if (cost) {
      out.cost = out.cost.plus(cost);
      out.costByBucket.set(
        l.bucket,
        (out.costByBucket.get(l.bucket) ?? D(0)).plus(cost),
      );
    } else {
      out.uncosted = out.uncosted.plus(revenue);
    }
    if (!l.productId) {
      out.custom.units += l.units;
      out.custom.revenue = out.custom.revenue.plus(revenue);
      continue;
    }
    const p = out.byProduct.get(l.productId) ?? {
      units: 0,
      revenue: D(0),
      cost: D(0),
    };
    out.byProduct.set(l.productId, {
      units: p.units + l.units,
      revenue: p.revenue.plus(revenue),
      cost: p.cost && cost ? p.cost.plus(cost) : null,
    });
  }
  return out;
}

/** part ÷ whole in percent, one decimal; null when there is no whole. */
export function percent(part: Amount, whole: Amount): string | null {
  const w = D(whole);
  if (w.isZero()) return null;
  return D(part).times(100).div(w).toFixed(1);
}
