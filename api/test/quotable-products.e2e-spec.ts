import type { QuotableProduct, QuotableSize } from '@forgea/types';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import { signedInAs } from './commerce-helpers.js';
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
});
