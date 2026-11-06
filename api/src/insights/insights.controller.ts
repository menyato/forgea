import { Controller, Get, Query } from '@nestjs/common';
import { type BusinessInsights, presetRange } from '@forgea/types';
import { PeriodQuery } from '@forgea/validation';
import { RequirePermission } from '../authorization/decorators.js';
import { InsightsService } from './insights.service.js';
import { studioDay } from '../common/studio-day.js';

const today = () => studioDay();

/**
 * The business page. Profit and production cost reveal the studio's margins, so it needs the
 * same permission as the books and reports.
 */
@Controller('insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  /** `from`–`to` (whole UTC days, two years at most), by default this month so far. */
  @RequirePermission('books.view')
  @Get()
  get(@Query() q: PeriodQuery): Promise<BusinessInsights> {
    const now = today();
    const range =
      q.from && q.to
        ? { from: q.from, to: q.to }
        : presetRange('this-month', now);
    return this.insights.forPeriod(range, now);
  }
}
