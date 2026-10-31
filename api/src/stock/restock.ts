/** One filament's numbers and the owner's limits for it. */
export interface RestockInput {
  stockGrams: number;
  committedGrams: number;
  used30Grams: number;
  used90Grams: number;
  lowStockGrams: number;
  spoolGrams: number;
  leadTimeDays: number;
  coverDays: number;
}

export interface RestockAdvice {
  availableGrams: number;
  /** Grams a day, one decimal. */
  dailyUseGrams: number;
  daysLeft: number | null;
  reorderPointGrams: number;
  needsRestock: boolean;
  suggestSpools: number;
  suggestGrams: number;
}

/**
 * When to buy filament and how much (the textbook reorder point): what is available is the
 * stock less what open orders will take; daily use is the busier of the last 30 and 90 days;
 * reorder at the owner's low-stock level plus what is used while a delivery comes (lead time),
 * and buy enough to get back above it for `coverDays` more, in whole spools.
 */
export function restockAdvice(i: RestockInput): RestockAdvice {
  const availableGrams = i.stockGrams - i.committedGrams;
  const daily = Math.max(i.used30Grams / 30, i.used90Grams / 90);
  const reorderPointGrams = i.lowStockGrams + Math.ceil(daily * i.leadTimeDays);
  const needsRestock = availableGrams <= reorderPointGrams;
  const target = reorderPointGrams + Math.ceil(daily * i.coverDays);
  const missing = Math.max(target - availableGrams, 0);
  const suggestSpools = needsRestock
    ? Math.max(Math.ceil(missing / i.spoolGrams), 1)
    : 0;
  return {
    availableGrams,
    dailyUseGrams: Math.round(daily * 10) / 10,
    daysLeft:
      daily > 0 ? Math.max(Math.floor(availableGrams / daily), 0) : null,
    reorderPointGrams,
    needsRestock,
    suggestSpools,
    suggestGrams: suggestSpools * i.spoolGrams,
  };
}
