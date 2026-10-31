import { Injectable } from '@nestjs/common';
import {
  bucketStarts,
  type BusinessInsights,
  type DateRange,
  granularityFor,
  type InsightsGranularity,
  type InsightsTotals,
  previousRange,
} from '@forgea/types';
import { Books } from '../accounting/books.service.js';
import type { Amount } from '../accounting/ledger-math.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Catalog } from '../stock/production-estimate.js';
import { ProductionEstimator } from '../stock/production-estimator.js';
import { StockRepository } from '../stock/stock.repository.js';
import { StockService } from '../stock/stock.service.js';
import { lineFigures, type LineFigures, percent } from './insights-math.js';
import { InsightsRepository } from './insights.repository.js';

const D = (v: Amount) => new Prisma.Decimal(v);
const money = (v: Amount) => D(v).toFixed(2);
const dateOf = (day: string) => new Date(`${day}T00:00:00Z`);

const TOP_PRODUCTS = 10;
const TOP_GROUPS = 6;
const TOP_VALUES = 8;

/**
 * The business page: what the period earned and cost, how sales went and what was used, next
 * to the period of the same length before. Revenue, expenses and net profit are the books'
 * (the profit and loss report itself); production cost is an estimate from today's pricing
 * settings and catalog (no cost is stored with orders), labelled so wherever it shows.
 */
@Injectable()
export class InsightsService {
  constructor(
    private readonly insights: InsightsRepository,
    private readonly books: Books,
    private readonly estimator: ProductionEstimator,
    private readonly stock: StockService,
    private readonly stockRows: StockRepository,
  ) {}

  async forPeriod(range: DateRange, today: string): Promise<BusinessInsights> {
    const previous = previousRange(range);
    const granularity = granularityFor(range);
    const taxRate = await this.insights.salesTaxRate();
    const [current, before, series, extra] = await Promise.all([
      this.totals(range, granularity, taxRate),
      this.totals(previous, granularity, taxRate),
      this.insights.incomeSeries(range, granularity),
      this.activity(range, today),
    ]);
    const income = new Map(series.map((s) => [s.bucket, s.income]));
    const products = [...current.lines.byProduct.entries()]
      .filter(([, p]) => p.units !== 0 || !p.revenue.isZero())
      .sort(([, a], [, b]) => b.revenue.comparedTo(a.revenue))
      .map(([productId, p]) => {
        const info = current.catalog.products.get(productId);
        return {
          productId,
          name: info?.name ?? 'Product no longer in the catalog',
          category: info?.category ?? null,
          units: p.units,
          revenue: money(p.revenue),
          productionCost: p.cost ? money(p.cost) : null,
          marginPercent: p.cost
            ? percent(p.revenue.minus(p.cost), p.revenue)
            : null,
        };
      });
    const categories = new Map<
      string | null,
      { units: number; revenue: Prisma.Decimal }
    >();
    for (const p of products) {
      const c = categories.get(p.category) ?? { units: 0, revenue: D(0) };
      categories.set(p.category, {
        units: c.units + p.units,
        revenue: c.revenue.plus(p.revenue),
      });
    }
    return {
      range,
      previous,
      granularity,
      current: current.totals,
      before: before.totals,
      expenses: current.expenses,
      series: bucketStarts(range, granularity).map((start) => {
        const revenue = D(income.get(start) ?? 0);
        const cost = current.lines.costByBucket.get(start) ?? D(0);
        return {
          start,
          revenue: money(revenue),
          productionCost: money(cost),
          grossProfit: money(revenue.minus(cost)),
        };
      }),
      products: products.slice(0, TOP_PRODUCTS),
      customWork: {
        units: current.lines.custom.units,
        revenue: money(current.lines.custom.revenue),
      },
      categories: [...categories.entries()]
        .map(([name, c]) => ({
          name,
          units: c.units,
          revenue: money(c.revenue),
        }))
        .sort((a, b) => D(b.revenue).comparedTo(a.revenue)),
      ...extra,
    };
  }

  /** The headline figures of one period, and what the products and chart need from it. */
  private async totals(
    range: DateRange,
    granularity: InsightsGranularity,
    taxRate: Prisma.Decimal | null,
  ): Promise<{
    totals: InsightsTotals;
    lines: LineFigures;
    catalog: Catalog;
    expenses: BusinessInsights['expenses'];
  }> {
    const [pnl, cash, orders, invoiced] = await Promise.all([
      this.books.profitAndLoss(dateOf(range.from), dateOf(range.to)),
      this.insights.money(range),
      this.insights.orders(range),
      this.insights.invoicedLines(range, granularity),
    ]);
    const { estimate, catalog } = await this.estimator.for(invoiced);
    const lines = lineFigures(
      invoiced.map((l) => {
        const e = estimate(l);
        return {
          bucket: l.bucket,
          productId: l.productId,
          units: l.units,
          gross: D(l.gross),
          unitCost: e ? D(e.unitCost) : null,
        };
      }),
      taxRate,
    );
    const revenue = D(pnl.totalIncome);
    const grossProfit = revenue.minus(lines.cost);
    const count = orders.placed - orders.cancelled;
    return {
      totals: {
        revenue: money(revenue),
        revenueWithTax: money(revenue.plus(cash.tax)),
        tax: money(cash.tax),
        productionCost: money(lines.cost),
        uncostedRevenue: money(lines.uncosted),
        grossProfit: money(grossProfit),
        grossMarginPercent: percent(grossProfit, revenue),
        expenses: pnl.totalExpenses,
        netProfit: pnl.netProfit,
        orders: count,
        orderValue: money(orders.value),
        averageOrderValue: count ? money(D(orders.value).div(count)) : null,
        cashCollected: money(cash.collected),
        owed: money(cash.owed),
      },
      lines,
      catalog,
      expenses: pnl.expenses,
    };
  }

  /** Orders, the sales funnel and filament: the current period only. */
  private async activity(range: DateRange, today: string) {
    const [
      orders,
      byStatus,
      customers,
      options,
      requests,
      quotations,
      leads,
      stock,
      usage,
    ] = await Promise.all([
      this.insights.orders(range),
      this.insights.byStatus(range),
      this.insights.customers(range),
      this.insights.options(range),
      this.insights.requests(range),
      this.insights.quotations(range),
      this.insights.leads(range),
      this.stock.items(today),
      this.stockRows.usageByItem(range),
    ]);
    const groups = new Map<string, { value: string; units: number }[]>();
    for (const o of options) {
      groups.set(o.group, [
        ...(groups.get(o.group) ?? []),
        { value: o.value, units: o.units },
      ]);
    }
    const used = new Map(usage.map((u) => [u.stockItemId, u]));
    return {
      options: [...groups.entries()]
        .map(([group, values]) => ({
          group,
          values: values.slice(0, TOP_VALUES),
        }))
        .sort(
          (a, b) =>
            b.values.reduce((s, v) => s + v.units, 0) -
            a.values.reduce((s, v) => s + v.units, 0),
        )
        .slice(0, TOP_GROUPS),
      orders: {
        placed: orders.placed,
        byStatus,
        cancelled: orders.cancelled,
        cancellationPercent: percent(orders.cancelled, orders.placed),
        newCustomers: customers.new,
        returningCustomers: customers.returning,
        delivery: orders.delivery,
        pickup: orders.pickup,
        cashOnDelivery: orders.cod,
        transfer: orders.transfer,
        rush: orders.rush,
      },
      requests,
      quotations,
      leads,
      materials: stock
        .map((s) => ({
          code: s.material.code,
          name: s.material.name,
          colour: s.colour,
          usedGrams: used.get(s.id)?.used ?? 0,
          failedGrams: used.get(s.id)?.failed ?? 0,
          stockGrams: s.stockGrams,
          daysLeft: s.daysLeft,
          needsRestock: s.needsRestock,
        }))
        .filter((m) => m.usedGrams > 0 || m.failedGrams > 0 || m.needsRestock)
        .sort(
          (a, b) => b.usedGrams + b.failedGrams - (a.usedGrams + a.failedGrams),
        ),
    };
  }
}
