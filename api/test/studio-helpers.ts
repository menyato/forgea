import { randomUUID } from 'node:crypto';
import { HTTP, PRODUCT_SIZE_GROUP_ID } from '@forgea/types';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { CSRF } from './commerce-helpers.js';

/**
 * Pricing settings with round numbers, so every cost in a test can be worked out by hand:
 * $1 a machine hour, 10% waste, 10% failures, $0.50 labour, $0.50 packaging, 100% profit;
 * rush 20%, delivery $4, no bulk discounts.
 */
export const ROUND_PRICING = {
  machineRatePerHour: '1.00',
  purgeWastePercent: '10',
  failureAllowancePercent: '10',
  laborCostPerUnit: '0.50',
  packagingCostPerUnit: '0.50',
  profitKind: 'PERCENT',
  profitValue: '100',
  // Cents, so the cost formulas show exactly; whole-dollar rounding has its own test.
  priceStep: '0.01',
  rushFeePercent: '20',
  deliveryFee: '4.00',
  depositPercent: '50',
  depositEnabled: true,
  depositAboveTotal: null,
  depositOnCustom: true,
  bulkDiscountTiers: [],
};

/** GET /pricing/settings, as the API returns it. */
export interface PricingSettingsBody {
  cost: Record<string, unknown> & { profit: { kind: string; value: string } };
  order: Record<string, unknown>;
  printer: {
    printerPrice: string;
    lifeHours: number;
    watts: number;
    electricityPerKwh: string;
  } | null;
  pricingPrinterId: string | null;
  electricityPerKwh: string | null;
}

/** The settings as the Pricing page sends them back (PUT /pricing/settings). */
export function pricingForm(s: PricingSettingsBody): Record<string, unknown> {
  const { profit, ...cost } = s.cost;
  return {
    ...cost,
    profitKind: profit.kind,
    profitValue: profit.value,
    ...s.order,
    ...(s.pricingPrinterId && { pricingPrinterId: s.pricingPrinterId }),
    ...(s.electricityPerKwh && { electricityPerKwh: s.electricityPerKwh }),
  };
}

/** Puts round pricing in place; returns a function that puts the previous settings back. */
export async function useRoundPricing(
  app: NestExpressApplication,
  adminCookie: string,
): Promise<() => Promise<void>> {
  const http = () => request(app.getHttpServer());
  const before = (
    await http().get('/pricing/settings').set('Cookie', adminCookie).expect(200)
  ).body as PricingSettingsBody;
  const put = (body: object) =>
    http()
      .put('/pricing/settings')
      .set(CSRF)
      .set('Cookie', adminCookie)
      .send(body)
      .expect(200);
  await put(ROUND_PRICING);
  return async () => {
    await put(pricingForm(before));
  };
}

/**
 * A material of its own ($0.05 a gram), a colour group (Red, and Copper silk at +$2), and a
 * vase in two real sizes: 10 × 10 × 10 cm (100 g, 5 h, the default) costs $13.00 to make and
 * sells at $26.00; 20 × 10 × 5 cm (200 g, 8 h) costs $22.60 and sells at $45.20.
 */
export async function createStudio(app: NestExpressApplication) {
  const prisma = app.get(PrismaService);
  const tag = randomUUID().slice(0, 8);
  const material = await prisma.material.create({
    data: {
      code: `T${tag.toUpperCase()}`,
      name: `Test filament ${tag}`,
      pricePerGram: '0.05',
      lowStockThresholdGrams: 500,
    },
  });
  // Its shelf: a stock line for each colour it sells (orders take only from lines that exist).
  await prisma.stockItem.createMany({
    data: ['Red', 'Copper silk'].map((colour) => ({
      materialId: material.id,
      colour,
      lowStockGrams: material.lowStockThresholdGrams,
    })),
  });
  const category = await prisma.category.create({
    data: { slug: `cat-${tag}`, name: `Vases ${tag}` },
  });
  const colour = await prisma.optionGroup.create({
    data: {
      name: `Colour ${tag}`,
      values: {
        create: [
          { label: 'Red', swatchHex: '#aa2222' },
          { label: 'Copper silk', swatchHex: '#b87333', extraPrice: '2.00' },
        ],
      },
    },
    include: { values: true },
  });
  const red = colour.values.find((v) => v.label === 'Red')!;
  const silk = colour.values.find((v) => v.label === 'Copper silk')!;
  const product = await prisma.product.create({
    data: {
      slug: `vase-${tag}`,
      name: `Vase ${tag}`,
      description: 'A vase in two sizes.',
      grams: 100,
      printHours: 5,
      materialId: material.id,
      categoryId: category.id,
      sizes: {
        create: [
          {
            label: 'Standard',
            sizeXcm: 10,
            sizeYcm: 10,
            sizeZcm: 10,
            grams: 100,
            printHours: 5,
            isDefault: true,
            sortOrder: 0,
          },
          {
            label: 'Wide',
            sizeXcm: 20,
            sizeYcm: 10,
            sizeZcm: 5,
            grams: 200,
            printHours: 8,
            sortOrder: 1,
          },
        ],
      },
      optionGroups: { create: [{ groupId: colour.id, required: true }] },
      optionValues: {
        create: [{ valueId: red.id, isDefault: true }, { valueId: silk.id }],
      },
    },
    include: { sizes: true },
  });
  const standard = product.sizes.find((s) => s.label === 'Standard')!;
  const wide = product.sizes.find((s) => s.label === 'Wide')!;
  return {
    tag,
    material,
    category,
    colourGroup: colour.name,
    product,
    /** Cart options for a size and colour. */
    options: (size: 'standard' | 'wide', value: 'red' | 'silk') => [
      {
        groupId: PRODUCT_SIZE_GROUP_ID,
        valueId: (size === 'standard' ? standard : wide).id,
      },
      { groupId: colour.id, valueId: (value === 'red' ? red : silk).id },
    ],
  };
}

export type Studio = Awaited<ReturnType<typeof createStudio>>;

let checkouts = 0;

/** A customer's order of the vase; returns the order's id and number. */
export async function placeOrder(
  app: NestExpressApplication,
  cookie: string,
  studio: Studio,
  line: {
    size: 'standard' | 'wide';
    colour: 'red' | 'silk';
    quantity: number;
    /** Other choices than the size and colour (a product's recoloured parts). */
    options?: object[];
  },
  how: {
    paymentMethod: 'COD' | 'TRANSFER';
    delivery: boolean;
    rush?: boolean;
  },
) {
  const http = () => request(app.getHttpServer());
  await http()
    .post('/cart/items')
    .set(CSRF)
    .set('Cookie', cookie)
    .send({
      productId: studio.product.id,
      quantity: line.quantity,
      options: line.options ?? studio.options(line.size, line.colour),
    })
    .expect(201);
  // Each checkout from its own address, as the storefront forwards it: a test placing many
  // orders never meets the checkout rate limit.
  checkouts += 1;
  const placed = await http()
    .post('/orders/checkout')
    .set(CSRF)
    .set('Cookie', cookie)
    .set(
      HTTP.PROXY_SECRET_HEADER,
      app.get(ConfigService).getOrThrow<string>('INTERNAL_PROXY_SECRET'),
    )
    .set(
      HTTP.FORWARDED_CLIENT_IP_HEADER,
      `10.88.${(checkouts >> 8) & 255}.${checkouts & 255}`,
    )
    .send({
      idempotencyKey: randomUUID(),
      name: 'Test Customer',
      phone: '70 123 456',
      paymentMethod: how.paymentMethod,
      delivery: how.delivery,
      rush: how.rush ?? false,
      ...(how.delivery ? { city: 'Beirut', addressLine: 'Hamra St' } : {}),
    })
    .expect(201);
  const order = await app.get(PrismaService).order.findUniqueOrThrow({
    where: { orderNumber: placed.body.orderNumber as string },
  });
  return order;
}

/** Moves an order through these statuses, one at a time, as staff. */
export async function moveOrder(
  app: NestExpressApplication,
  staffCookie: string,
  orderId: string,
  statuses: string[],
) {
  for (const status of statuses) {
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set(CSRF)
      .set('Cookie', staffCookie)
      .send({ status })
      .expect(200);
  }
}

/** Picks the suggested reel for each colour of an order's 3MF lines (before production). */
export async function pickReels(
  app: NestExpressApplication,
  staffCookie: string,
  orderId: string,
): Promise<void> {
  const res = await request(app.getHttpServer())
    .get(`/orders/${orderId}/filaments`)
    .set('Cookie', staffCookie)
    .expect(200);
  const lines = (
    res.body as {
      lines: {
        orderItemId: string;
        colours: { colour: string; suggestedId: string | null }[];
      }[];
    }
  ).lines;
  await request(app.getHttpServer())
    .put(`/orders/${orderId}/filaments`)
    .set(CSRF)
    .set('Cookie', staffCookie)
    .send({
      lines: lines.map((l) => ({
        orderItemId: l.orderItemId,
        colours: l.colours.map((c) => ({
          colour: c.colour,
          stockItemId: c.suggestedId,
        })),
      })),
    })
    .expect(200);
}

/** The steps to delivery: pickup orders skip "out for delivery". */
export const TO_DELIVERED = (delivery: boolean) => [
  'CONFIRMED',
  'IN_PRODUCTION',
  'READY',
  ...(delivery ? ['OUT_FOR_DELIVERY'] : []),
  'DELIVERED',
];
