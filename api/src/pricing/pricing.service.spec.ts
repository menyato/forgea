import { Test, TestingModule } from '@nestjs/testing';
import {
  PricingSettingsRepository,
  type PricingSettingsSnapshot,
} from './pricing-settings.repository.js';
import { PricingService } from './pricing.service.js';

class FakeSettingsRepository extends PricingSettingsRepository {
  snapshot: PricingSettingsSnapshot = {
    cost: {
      machineRatePerHour: '10',
      purgeWastePercent: '5',
      failureAllowancePercent: '10',
      laborCostPerUnit: '5',
      packagingCostPerUnit: '3',
      profit: { kind: 'PERCENT', value: '60' },
    },
    order: {
      rushFeePercent: '30',
      deliveryFee: '25',
      depositPercent: '50',
      bulkDiscountTiers: [{ minQuantity: 10, percent: '5' }],
    },
    printer: null,
    pricingPrinterId: null,
    electricityPerKwh: null,
  };

  current(): Promise<PricingSettingsSnapshot> {
    return Promise.resolve(this.snapshot);
  }

  save(settings: PricingSettingsSnapshot): Promise<void> {
    this.snapshot = settings;
    return Promise.resolve();
  }

  printer(): Promise<null> {
    return Promise.resolve(null);
  }
}

describe('PricingService', () => {
  let service: PricingService;
  let repo: FakeSettingsRepository;

  beforeEach(async () => {
    repo = new FakeSettingsRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PricingService,
        { provide: PricingSettingsRepository, useValue: repo },
      ],
    }).compile();
    service = module.get(PricingService);
  });

  it('never exposes cost settings in the public order settings', async () => {
    const pub = await service.publicOrderSettings();
    expect(Object.keys(pub).sort()).toEqual([
      'bulkDiscountTiers',
      'deliveryFee',
      'depositPercent',
      'rushFeePercent',
    ]);
    expect(JSON.stringify(pub)).not.toMatch(
      /markup|machine|labor|packaging|waste|failure/i,
    );
  });

  it('prices a unit from the stored cost settings', async () => {
    const result = await service.unitPrice({
      grams: 120,
      printHours: 4.5,
      pricePerGram: 0.12,
    });
    expect(result.unitPrice).toBe('122.10');
  });

  it('quotes an order from the stored order settings', async () => {
    const quote = await service.quoteOrder(
      [
        {
          id: 'a',
          name: 'Part',
          unitPrice: '10',
          quantity: 10,
          isCustom: true,
        },
      ],
      { rush: false, delivery: true },
    );
    // 100 − 5% = 95 + delivery 25
    expect(quote.total).toBe('120.00');
    expect(quote.depositRequired).toBe('47.50');
  });

  it('uses the latest settings on every call', async () => {
    repo.snapshot = {
      ...repo.snapshot,
      cost: {
        ...repo.snapshot.cost,
        profit: { kind: 'PERCENT', value: '100' },
      },
    };
    const result = await service.unitPrice({
      grams: 120,
      printHours: 4.5,
      pricePerGram: 0.12,
    });
    expect(result.unitPrice).toBe('152.62');
  });
});
