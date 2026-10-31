import { restockAdvice } from './restock.js';

const settings = {
  lowStockGrams: 500,
  spoolGrams: 1000,
  leadTimeDays: 7,
  coverDays: 30,
};

describe('restockAdvice', () => {
  it('reorders at the low level plus what the lead time uses, and buys whole spools', () => {
    // 600 g in 30 days = 20 g a day (the 90 days were quieter).
    const advice = restockAdvice({
      ...settings,
      stockGrams: 1200,
      committedGrams: 300,
      used30Grams: 600,
      used90Grams: 900,
    });
    expect(advice).toEqual({
      availableGrams: 900,
      dailyUseGrams: 20,
      daysLeft: 45,
      // 500 + 20 × 7
      reorderPointGrams: 640,
      needsRestock: false,
      suggestSpools: 0,
      suggestGrams: 0,
    });
  });

  it('flags a filament under its reorder point and covers the days asked', () => {
    const advice = restockAdvice({
      ...settings,
      stockGrams: 700,
      committedGrams: 200,
      used30Grams: 600,
      used90Grams: 0,
    });
    // Target 640 + 20 × 30 = 1240; 1240 − 500 = 740 g → 1 spool.
    expect(advice).toMatchObject({
      availableGrams: 500,
      daysLeft: 25,
      needsRestock: true,
      suggestSpools: 1,
      suggestGrams: 1000,
    });
  });

  it('uses the busier period, and suggests at least one spool when flagged', () => {
    const busy = restockAdvice({
      ...settings,
      stockGrams: 0,
      committedGrams: 0,
      used30Grams: 0,
      used90Grams: 9000,
    });
    // 100 g a day: 500 + 700 = 1200; + 3000 = 4200 → 5 spools.
    expect(busy).toMatchObject({
      dailyUseGrams: 100,
      daysLeft: 0,
      reorderPointGrams: 1200,
      suggestSpools: 5,
    });
    const idle = restockAdvice({
      ...settings,
      stockGrams: 500,
      committedGrams: 0,
      used30Grams: 0,
      used90Grams: 0,
    });
    expect(idle).toMatchObject({
      daysLeft: null,
      needsRestock: true,
      suggestSpools: 1,
    });
  });

  it('counts open orders that would take more than is left', () => {
    expect(
      restockAdvice({
        ...settings,
        stockGrams: 100,
        committedGrams: 400,
        used30Grams: 30,
        used90Grams: 0,
      }),
    ).toMatchObject({ availableGrams: -300, daysLeft: 0, needsRestock: true });
  });
});
