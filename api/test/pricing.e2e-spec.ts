import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { createApp } from './create-app.js';
import { PricingService } from './../src/pricing/pricing.service.js';

// Runs against the migrated database in DATABASE_URL (settings seeded by the migration).
describe('Pricing (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = (await createApp()) as unknown as INestApplication<App>;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /pricing/order-settings returns the stored customer-facing settings', async () => {
    const res = await request(app.getHttpServer())
      .get('/pricing/order-settings')
      .expect(200);
    expect(Object.keys(res.body as object).sort()).toEqual([
      'bulkDiscountTiers',
      'deliveryFee',
      'depositPercent',
      'rushFeePercent',
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(
      /markup|machine|labor|packaging|waste|failure/i,
    );
  });

  it('prices from the database settings end to end', async () => {
    const pricing = app.get(PricingService);
    const unit = await pricing.unitPrice({
      grams: '120',
      printHours: '4.5',
      pricePerGram: '0.12',
    });
    const quote = await pricing.quoteOrder(
      [
        {
          id: 'x',
          name: 'Test part',
          unitPrice: unit.unitPrice,
          quantity: 1,
          isCustom: true,
        },
      ],
      { rush: false, delivery: false },
    );
    expect(quote.total).toBe(unit.unitPrice);
    expect(Number(quote.depositRequired)).toBeGreaterThan(0);
  });
});
