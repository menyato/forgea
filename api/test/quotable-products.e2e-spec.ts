import type {
  AdminProduct,
  QuotableProduct,
  QuotableSize,
} from '@forgea/types';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import { CSRF, signedInAs } from './commerce-helpers.js';
import { createApp } from './create-app.js';
import { createStudio, type Studio } from './studio-helpers.js';

/**
 * A product that isn't launched in the shop (a piece made for one client) can still go on a
 * quotation: the studio's list has it, with its price and its sizes; shoppers never see it.
 */
describe('Quotable products, hidden ones too (e2e)', () => {
  let app: NestExpressApplication;
  let studio: Studio;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    studio = await createStudio(app);
    await app.get(PrismaService).product.update({
      where: { id: studio.product.id },
      data: { active: false },
    });
  });
  afterAll(async () => {
    await app.close();
  });

  it('lists a hidden product for the studio, with its price and sizes', async () => {
    const staff = await signedInAs(app, Role.STAFF);
    const list = (
      await http()
        .get('/products/quotable')
        .set('Cookie', staff.cookie)
        .expect(200)
    ).body as QuotableProduct[];
    const mine = list.find((p) => p.id === studio.product.id)!;
    expect(mine).toMatchObject({ slug: studio.product.slug, active: false });
    expect(Number(mine.price)).toBeGreaterThan(0);

    const sizes = (
      await http()
        .get(`/products/quotable/${studio.product.slug}/sizes`)
        .set('Cookie', staff.cookie)
        .expect(200)
    ).body as QuotableSize[];
    expect(sizes.map((s) => [s.label, s.x, s.y, s.z])).toEqual([
      ['10 × 10 × 10 cm', '10', '10', '10'],
      ['20 × 10 × 5 cm', '20', '10', '5'],
    ]);
    // The wide size takes twice the filament: it costs more.
    expect(Number(sizes[1]!.unitPrice)).toBeGreaterThan(
      Number(sizes[0]!.unitPrice),
    );
  });

  it('is the studio’s list only: shoppers and customers never get it', async () => {
    await http().get(`/products/${studio.product.slug}`).expect(404);
    await http().get('/products/quotable').expect(401);
    const customer = await signedInAs(app, Role.CUSTOMER);
    await http()
      .get('/products/quotable')
      .set('Cookie', customer.cookie)
      .expect(403);
    await http()
      .get(`/products/quotable/${studio.product.slug}/sizes`)
      .set('Cookie', customer.cookie)
      .expect(403);
  });

  it('a studio-only product is never sold: not quotable, never shown, never on a quotation', async () => {
    const admin = await signedInAs(app, Role.ADMIN);
    const other = await createStudio(app);
    const id = other.product.id;
    const product = (
      await http()
        .get(`/products/manage/${id}`)
        .set('Cookie', admin.cookie)
        .expect(200)
    ).body as AdminProduct;
    expect(product.studioOnly).toBe(false);
    const put = (body: object) =>
      http()
        .put(`/products/${id}`)
        .set(CSRF)
        .set('Cookie', admin.cookie)
        .send({
          slug: product.slug,
          name: product.name,
          description: product.description,
          materialId: product.materialId,
          grams: product.grams,
          printHours: product.printHours,
          isCustom: false,
          imageKeys: [],
          options: [],
          sizes: [],
          ...body,
        });
    // Shown in the shop and studio only at once: refused, by the API and the database.
    await put({ active: true, studioOnly: true }).expect(400);
    await expect(
      app.get(PrismaService).product.update({
        where: { id },
        data: { studioOnly: true, active: true },
      }),
    ).rejects.toThrow();
    const saved = (await put({ active: false, studioOnly: true }).expect(200))
      .body as AdminProduct;
    expect(saved).toMatchObject({ studioOnly: true, active: false });

    const list = (
      await http()
        .get('/products/quotable')
        .set('Cookie', admin.cookie)
        .expect(200)
    ).body as QuotableProduct[];
    expect(list.some((p) => p.id === id)).toBe(false);
    await http()
      .post('/quotations')
      .set(CSRF)
      .set('Cookie', admin.cookie)
      .send({
        customerEmail: `studio-only-${other.tag}@example.com`,
        validUntil: '2099-12-31',
        customerName: 'Test',
        phone: '70 111 222',
        paymentMethod: 'TRANSFER',
        delivery: false,
        lines: [
          {
            productId: id,
            description: 'A piece',
            quantity: 1,
            unitPrice: '5.00',
          },
        ],
      })
      .expect(400);
  });
});
