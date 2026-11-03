import { randomUUID } from 'node:crypto';
import type { CatalogFile } from '@forgea/types';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import {
  CSRF,
  cubeStl,
  signedInAs,
  signedInCustomer,
} from './commerce-helpers.js';
import { createApp } from './create-app.js';

/** A small catalog with names unique to this run, so it never meets other tests' data. */
function catalog(tag: string): CatalogFile {
  return {
    format: 'forgea-catalog',
    version: 1,
    materials: [
      {
        code: `T${tag}`.toUpperCase(),
        name: `Test resin ${tag}`,
        pricePerGram: '0.05',
        densityGPerCm3: '1.1',
        gramsPerHour: '8',
        active: true,
      },
    ],
    categories: [
      {
        slug: `vases-${tag}`,
        name: `Vases ${tag}`,
        description: 'Imported',
        sortOrder: 5,
        active: true,
      },
    ],
    optionGroups: [
      {
        name: `Glaze ${tag}`,
        kind: 'CHOICE',
        maxLength: null,
        textExtraPrice: '0',
        sortOrder: 9,
        active: true,
        values: [
          {
            label: 'Matte',
            swatchHex: '#333333',
            gramsMultiplier: '1',
            hoursMultiplier: '1',
            extraPrice: '0',
            material: null,
            sortOrder: 0,
            active: true,
          },
          {
            label: 'Gloss',
            swatchHex: null,
            gramsMultiplier: '1',
            hoursMultiplier: '1.2',
            extraPrice: '2.00',
            material: `T${tag}`.toUpperCase(),
            sortOrder: 1,
            active: true,
          },
        ],
      },
    ],
    products: [
      {
        slug: `imported-vase-${tag}`,
        name: 'Imported vase',
        description: 'From a catalog file.',
        category: `vases-${tag}`,
        material: `T${tag}`.toUpperCase(),
        grams: '80',
        printHours: '5',
        isCustom: false,
        designer: 'Guest designer',
        active: true,
        model: { name: 'vase.stl', base64: cubeStl(30).toString('base64') },
        images: [],
        options: [
          {
            group: `Glaze ${tag}`,
            required: true,
            values: ['Matte', 'Gloss'],
            default: 'Matte',
          },
        ],
      },
    ],
  };
}

describe('Catalog transfer (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const upload = (cookie: string, file: unknown, mode?: string) =>
    http()
      .post(`/catalog-transfer/import${mode ? `?mode=${mode}` : ''}`)
      .set(CSRF)
      .set('Cookie', cookie)
      .attach('file', Buffer.from(JSON.stringify(file)), 'catalog.json');

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });
  afterAll(() => app.close());

  it('imports a catalog file, adds only what is missing, overwrites on request', async () => {
    const tag = randomUUID().slice(0, 6);
    const admin = await signedInAs(app, Role.ADMIN);
    const file = catalog(tag);

    const first = await upload(admin.cookie, file).expect(200);
    expect(first.body.created).toEqual({
      materials: 1,
      categories: 1,
      optionGroups: 1,
      optionValues: 2,
      fonts: 0,
      products: 1,
    });
    const product = await http()
      .get(`/products/imported-vase-${tag}`)
      .expect(200);
    expect(product.body).toMatchObject({
      designer: 'Guest designer',
      category: { slug: `vases-${tag}` },
      modelKey: expect.stringMatching(/^clean\/.+\.stl$/),
    });
    expect(
      product.body.options[0].choices.map((c: { label: string }) => c.label),
    ).toEqual(['Matte', 'Gloss']);

    // Again, adding: nothing changes, and the model is stored once.
    const again = await upload(admin.cookie, file).expect(200);
    expect(Object.values(again.body.created).every((n) => n === 0)).toBe(true);
    const renamed = structuredClone(file);
    renamed.products[0]!.name = 'Imported vase, renamed';
    await upload(admin.cookie, renamed).expect(200);
    expect((await http().get(`/products/imported-vase-${tag}`)).body.name).toBe(
      'Imported vase',
    );

    // Updating overwrites the matches.
    const updated = await upload(admin.cookie, renamed, 'update').expect(200);
    expect(updated.body.updated.products).toBe(1);
    const after = await http()
      .get(`/products/imported-vase-${tag}`)
      .expect(200);
    expect(after.body.name).toBe('Imported vase, renamed');
    expect(after.body.modelKey).toBe(product.body.modelKey);
    await prisma.auditLog.findFirstOrThrow({
      where: { actorUserId: admin.user.id, action: 'catalog.import' },
    });
  });

  it('says exactly which entry is wrong, and refuses files that are not catalogs', async () => {
    const tag = randomUUID().slice(0, 6);
    const admin = await signedInAs(app, Role.ADMIN);
    const bad = catalog(tag);
    bad.products[0]!.grams = 'lots';
    const res = await upload(admin.cookie, bad).expect(400);
    expect(res.body.message).toMatch(
      new RegExp(`^products\\[0\\] "imported-vase-${tag}": grams`),
    );

    const unknownGroup = catalog(randomUUID().slice(0, 6));
    unknownGroup.products[0]!.options[0]!.group = 'Nope';
    expect(
      (await upload(admin.cookie, unknownGroup).expect(400)).body.message,
    ).toMatch(/unknown option group "Nope"/);
    const notStl = catalog(randomUUID().slice(0, 6));
    notStl.products[0]!.model = {
      name: 'x.stl',
      base64: Buffer.from('#!/bin/sh').toString('base64'),
    };
    expect(
      (await upload(admin.cookie, notStl).expect(400)).body.message,
    ).toMatch(/not accepted/);

    await upload(admin.cookie, { hello: 'world' }).expect(400);
    await upload(admin.cookie, { format: 'forgea-catalog', version: 2 }).expect(
      400,
    );
    await upload(admin.cookie, catalog(tag), 'replace').expect(400);
    await http()
      .post('/catalog-transfer/import')
      .set(CSRF)
      .set('Cookie', admin.cookie)
      .attach('file', Buffer.from('{not json'), 'x.json')
      .expect(400);
  });

  it('exports everything needed to rebuild the catalog elsewhere; admins only', async () => {
    const tag = randomUUID().slice(0, 6);
    const admin = await signedInAs(app, Role.ADMIN);
    await upload(admin.cookie, catalog(tag)).expect(200);
    await http()
      .get('/catalog-transfer/export')
      .set('Cookie', (await signedInAs(app, Role.DESIGNER)).cookie)
      .expect(403);
    const res = await http()
      .get('/catalog-transfer/export')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="forgea-catalog-/,
    );
    const exported = res.body as CatalogFile;
    expect(exported).toMatchObject({ format: 'forgea-catalog', version: 1 });
    const vase = exported.products.find(
      (p) => p.slug === `imported-vase-${tag}`,
    );
    expect(vase).toMatchObject({
      category: `vases-${tag}`,
      designer: 'Guest designer',
      options: [
        { group: `Glaze ${tag}`, values: ['Matte', 'Gloss'], default: 'Matte' },
      ],
    });
    expect(Buffer.from(vase!.model!.base64, 'base64')).toEqual(cubeStl(30));
    expect(JSON.stringify(exported)).not.toMatch(/stockGrams|"id"/);

    // Re-importing the export into the same catalog changes nothing.
    const back = await upload(admin.cookie, exported).expect(200);
    expect(Object.values(back.body.created).every((n) => n === 0)).toBe(true);
  });
});

describe('Designer role (e2e)', () => {
  let app: NestExpressApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  it('designers run the catalog and add designs to requests; money stays with staff and admins', async () => {
    const designer = await signedInAs(app, Role.DESIGNER);
    const as = (method: 'get' | 'post' | 'put', url: string) =>
      http()[method](url).set(CSRF).set('Cookie', designer.cookie);

    const materials = await as('get', '/materials').expect(200);
    const pla = materials.body.find((m: { code: string }) => m.code === 'PLA');
    await as('put', `/materials/${pla.id}`)
      .send({ ...pla, pricePerGram: '0.01' })
      .expect(403);
    await as('get', '/products/manage').expect(200);
    await as('post', '/products')
      .send({
        slug: `designer-${randomUUID().slice(0, 6)}`,
        name: 'Designer piece',
        description: 'Made by the design team.',
        materialId: pla.id,
        grams: '40',
        printHours: '2',
        isCustom: false,
        designer: 'Maya',
        active: true,
      })
      .expect(201);
    for (const url of [
      '/orders',
      '/pricing/settings',
      '/users',
      '/audit-log',
    ]) {
      await as('get', url).expect(403);
    }

    // A customer's request: the designer adds a 3D design; only staff send the price.
    const customer = await signedInCustomer(app);
    const { body } = await http()
      .post('/custom-requests')
      .set(CSRF)
      .set('Cookie', customer.cookie)
      .send({
        title: 'Vase for my mother',
        description: 'A tall twisted vase, about 25 cm.',
      })
      .expect(201);
    const inbox = await as(
      'get',
      `/custom-requests?q=${body.requestNumber}`,
    ).expect(200);
    const id = inbox.body.items[0].id;
    const designed = await http()
      .post(`/custom-requests/${id}/design`)
      .set(CSRF)
      .set('Cookie', designer.cookie)
      .attach('file', cubeStl(20), 'design.stl')
      .expect(201);
    expect(designed.body.design).toMatchObject({ kind: 'model' });
    await as('post', `/custom-requests/${id}/quote`)
      .send({ price: '20' })
      .expect(403);

    // The customer sees the design on their request; others don't.
    const mine = await http()
      .get(`/custom-requests/mine/${body.requestNumber}`)
      .set('Cookie', customer.cookie)
      .expect(200);
    expect(mine.body.design.key).toBe(designed.body.design.key);
    await http()
      .get(`/media/${mine.body.design.key}`)
      .set('Cookie', customer.cookie)
      .expect(200);
    await http()
      .get(`/media/${mine.body.design.key}`)
      .set('Cookie', (await signedInCustomer(app)).cookie)
      .expect(404);
  });
});
