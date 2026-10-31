import type { ReportLine } from './crm.js';
import type { OrderStatus } from './generated/prisma/enums.js';
import type { Money } from './lists.js';

/**
 * The business dashboard (GET /insights): a period of whole days, in UTC like the books
 * (an entry's date is the UTC day it was posted), compared with the period of the same length
 * just before it.
 */
export interface DateRange {
  /** First day, "2026-10-01". */
  from: string;
  /** Last day, included. */
  to: string;
}

/** How the chart groups days: by day up to a month, by week up to half a year, else by month. */
export type InsightsGranularity = 'day' | 'week' | 'month';

/** The longest period the dashboard adds up (about two years). */
export const INSIGHTS_MAX_DAYS = 731;

export const PERIOD_PRESETS = [
  'this-month',
  'last-month',
  'last-3-months',
  'this-year',
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_PRESET_LABELS: Readonly<Record<PeriodPreset, string>> = {
  'this-month': 'This month',
  'last-month': 'Last month',
  'last-3-months': 'Last 3 months',
  'this-year': 'This year',
};

const DAY_MS = 86_400_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const toTime = (day: string) => Date.parse(`${day}T00:00:00Z`);
const toDay = (time: number) => new Date(time).toISOString().slice(0, 10);
const addDays = (day: string, days: number) =>
  toDay(toTime(day) + days * DAY_MS);

/** "2026-02-30" is not a day; "2026-02-28" is. */
export function isCalendarDay(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const time = toTime(value);
  return !Number.isNaN(time) && toDay(time) === value;
}

/** Days in a period, both ends included. */
export const daysIn = (range: DateRange): number =>
  Math.round((toTime(range.to) - toTime(range.from)) / DAY_MS) + 1;

/** A preset as dates, up to `today` ("this month" is the 1st to today). */
export function presetRange(preset: PeriodPreset, today: string): DateRange {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  const first = (y: number, m: number) => toDay(Date.UTC(y, m, 1));
  switch (preset) {
    case 'this-month':
      return { from: first(year, month), to: today };
    case 'last-month':
      return {
        from: first(year, month - 1),
        to: addDays(first(year, month), -1),
      };
    case 'last-3-months':
      return { from: first(year, month - 2), to: today };
    case 'this-year':
      return { from: first(year, 0), to: today };
  }
}

/** The preset these dates are, if any (to highlight it in the picker). */
export function presetOf(range: DateRange, today: string): PeriodPreset | null {
  return (
    PERIOD_PRESETS.find((p) => {
      const r = presetRange(p, today);
      return r.from === range.from && r.to === range.to;
    }) ?? null
  );
}

/** The period of the same length that ends the day before this one starts. */
export function previousRange(range: DateRange): DateRange {
  return {
    from: addDays(range.from, -daysIn(range)),
    to: addDays(range.from, -1),
  };
}

export function granularityFor(range: DateRange): InsightsGranularity {
  const days = daysIn(range);
  if (days <= 31) return 'day';
  if (days <= 184) return 'week';
  return 'month';
}

/**
 * Where each chart bar starts, as Postgres' date_trunc gives them: days, Mondays (the first
 * may be before `from`), or the 1st of each month.
 */
export function bucketStarts(
  range: DateRange,
  granularity: InsightsGranularity,
): string[] {
  const start = (day: string) => {
    if (granularity === 'day') return day;
    if (granularity === 'month') return `${day.slice(0, 7)}-01`;
    const weekday = (new Date(toTime(day)).getUTCDay() + 6) % 7; // Monday = 0
    return addDays(day, -weekday);
  };
  const next = (day: string) => {
    if (granularity === 'day') return addDays(day, 1);
    if (granularity === 'week') return addDays(day, 7);
    const d = new Date(toTime(day));
    return toDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  };
  const starts: string[] = [];
  for (let d = start(range.from); d <= range.to; d = next(d)) starts.push(d);
  return starts;
}

/**
 * Why a period can't be shown, in words for the owner; null when it can. Both dates or
 * neither (neither = this month).
 */
export function periodError(
  from: string | undefined,
  to: string | undefined,
): string | null {
  if (from === undefined && to === undefined) return null;
  if (from === undefined || to === undefined) return 'Choose both dates';
  if (!isCalendarDay(from) || !isCalendarDay(to)) return 'Enter real dates';
  if (from > to) return 'The start date must be before the end date';
  if (daysIn({ from, to }) > INSIGHTS_MAX_DAYS)
    return 'Choose a period of two years at most';
  return null;
}

/**
 * The change from the previous period in percent (one decimal), for the ↑/↓ beside a figure;
 * null when there was nothing before to compare with.
 */
export function percentChange(
  current: string | number,
  previous: string | number,
): number | null {
  const now = Number(current);
  const before = Number(previous);
  if (before === 0) return null;
  return Math.round(((now - before) / Math.abs(before)) * 1000) / 10;
}

/** The headline figures of one period. Money in USD, tax included only where it says so. */
export interface InsightsTotals {
  /** Sales in the books (income accounts), taxes excluded, credit notes taken off. */
  revenue: Money;
  /** The same sales as customers paid them: revenue + the tax in them. */
  revenueWithTax: Money;
  tax: Money;
  /**
   * What making the invoiced products costs, ESTIMATED with today's pricing settings and each
   * product's (or chosen size's) grams and hours, before markup.
   */
  productionCost: Money;
  /** Part of revenue with no cost estimate: custom work and lines without a catalog product. */
  uncostedRevenue: Money;
  /** revenue − productionCost (estimated). */
  grossProfit: Money;
  /** grossProfit ÷ revenue, in percent; null without revenue. */
  grossMarginPercent: string | null;
  /** Expense accounts in the books (rent, filament bought…), as recorded. */
  expenses: Money;
  /** What the books say: revenue − expenses. */
  netProfit: Money;
  /** Orders placed in the period, cancelled ones left out. */
  orders: number;
  /** Their totals, tax and delivery included. */
  orderValue: Money;
  averageOrderValue: Money | null;
  /** Payments received from customers in the period (cash and transfers). */
  cashCollected: Money;
  /** What customers still owed at the end of the period. */
  owed: Money;
}

export interface InsightsSeriesPoint {
  /** The first day of the bar (see bucketStarts). */
  start: string;
  revenue: Money;
  productionCost: Money;
  grossProfit: Money;
}

export interface InsightsProduct {
  productId: string;
  name: string;
  category: string | null;
  units: number;
  /** Taxes excluded. */
  revenue: Money;
  /** Estimated; null when it can't be (e.g. a product without grams). */
  productionCost: Money | null;
  marginPercent: string | null;
}

/** One filament (material and colour) in the period, from the stock movements. */
export interface InsightsMaterial {
  code: string;
  name: string;
  colour: string;
  /** Taken out of stock by orders going into production, and other recorded use. */
  usedGrams: number;
  /** Lost to failed prints. */
  failedGrams: number;
  /** Now (not at the end of the period), with the restock advice of the Stock page. */
  stockGrams: number;
  daysLeft: number | null;
  needsRestock: boolean;
}

/** GET /insights?from=&to= */
export interface BusinessInsights {
  range: DateRange;
  previous: DateRange;
  granularity: InsightsGranularity;
  current: InsightsTotals;
  before: InsightsTotals;
  /** The current period's expenses by account. */
  expenses: ReportLine[];
  series: InsightsSeriesPoint[];
  /** Products invoiced in the period, by revenue (the top ones). */
  products: InsightsProduct[];
  /** Invoiced lines without a catalog product (custom requests, free quotation lines). */
  customWork: { units: number; revenue: Money };
  categories: { name: string | null; units: number; revenue: Money }[];
  /** What customers chose on the orders they placed: sizes, colours… (most chosen first). */
  options: { group: string; values: { value: string; units: number }[] }[];
  orders: {
    /** Every order placed in the period, cancelled ones included. */
    placed: number;
    byStatus: Partial<Record<OrderStatus, number>>;
    cancelled: number;
    cancellationPercent: string | null;
    /** People whose first order ever was placed in the period, and the others. */
    newCustomers: number;
    returningCustomers: number;
    delivery: number;
    pickup: number;
    cashOnDelivery: number;
    transfer: number;
    rush: number;
  };
  /** Custom requests sent in the period: how many were quoted, how many accepted. */
  requests: { submitted: number; quoted: number; accepted: number };
  /** Quotations written in the period: sent, confirmed. */
  quotations: { created: number; sent: number; confirmed: number };
  /** Leads that came in, and those won or lost in the period (with why). */
  leads: {
    created: number;
    won: number;
    lost: number;
    lostReasons: { name: string; count: number }[];
  };
  materials: InsightsMaterial[];
}
