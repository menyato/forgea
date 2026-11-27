import { Test, TestingModule } from '@nestjs/testing';
import { PricingController } from './pricing.controller.js';
import { PricingService } from './pricing.service.js';

describe('PricingController', () => {
  it('delegates to the service without adding logic', async () => {
    const settings = {
      rushFeePercent: '30',
      deliveryFee: '25',
      depositPercent: '50',
      depositEnabled: true,
      depositAboveTotal: '30',
      depositOnCustom: false,
      bulkDiscountTiers: [],
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PricingController],
      providers: [
        {
          provide: PricingService,
          useValue: { publicOrderSettings: () => Promise.resolve(settings) },
        },
      ],
    }).compile();

    await expect(module.get(PricingController).orderSettings()).resolves.toBe(
      settings,
    );
  });
});
