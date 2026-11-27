import type { Page, StockMovementView, StockOverview } from '@forgea/types';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import { CSRF, signedInAs } from './commerce-helpers.js';
import { createApp } from './create-app.js';
import { createStudio, type Studio } from './studio-helpers.js';

/**
 * Putting the shelf right: a print recorded on the wrong filament moves to the one it really
 * was (the database allows that change only), its history says where it was first and opens
 * what it was for; a sweep weighs every filament at once.
 */
describe('Filament fixes: wrong filament, sweeps (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  let admin: Awaited<ReturnType<typeof signedInAs>>;
  let designer: Awaited<ReturnType<typeof signedInAs>>;
  let studio: Studio;
  let other: Studio;

  const as = (cookie: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    post: (url: string, body: object = {}) =>
      http().post(url).set(CSRF).set('Cookie', cookie).send(body),
  });
  const lineOf = async (materialId: string, colour: string) =>
    (
      (await as(admin.cookie).get('/stock').expect(200)).body as StockOverview
    ).items.find((i) => i.material.id === materialId && i.colour === colour)!;
  const materialGrams = async (id: string) =>
    (await prisma.material.findUniqueOrThrow({ where: { id } })).stockGrams;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    admin = await signedInAs(app, Role.ADMIN);
    designer = await signedInAs(app, Role.DESIGNER);
    studio = await createStudio(app);
    // Another material's shelf (PETG next to PLA, say).
    other = await createStudio(app);
    for (const [materialId, colour] of [
      [studio.material.id, 'Red'],
      [other.material.id, 'Red'],
    ] as const)
      await as(admin.cookie)
        .post('/stock/receipts', {
          materialId,
          colour,
          spools: 1,
          spoolGrams: 1000,
          pricePerSpool: '20.00',
          updateCost: false,
        })
        .expect(204);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a print recorded on the wrong filament moves to the one it really was', async () => {
    const note = `Bin ${Date.now().toString(36)}`;
    await as(admin.cookie)
      .post('/stock/studio-prints', {
        productId: studio.product.id,
        colour: 'Red',
        quantity: 1,
        toShelf: false,
        note,
      })
      .expect(200);
    const [take] = (
      (
        await as(admin.cookie)
          .get(`/stock/movements?q=${encodeURIComponent(note)}`)
          .expect(200)
      ).body as Page<StockMovementView>
    ).items;
    expect(take).toMatchObject({
      kind: 'USED',
      movable: true,
      moved: null,
      links: { productId: studio.product.id },
    });
    expect(take!.links.pieceId).toEqual(expect.any(String));
    const used = -take!.grams;
    const wrong = await lineOf(studio.material.id, 'Red');
    const right = await lineOf(other.material.id, 'Red');
    const [plaBefore, petgBefore] = [
      await materialGrams(studio.material.id),
      await materialGrams(other.material.id),
    ];

    // Only those who record stock move it, and never onto the filament it is on.
    await as(designer.cookie)
      .post(`/stock/movements/${take!.id}/move`, { stockItemId: right.id })
      .expect(403);
    await as(admin.cookie)
      .post(`/stock/movements/${take!.id}/move`, { stockItemId: wrong.id })
      .expect(400);

    const moved = (
      await as(admin.cookie)
        .post(`/stock/movements/${take!.id}/move`, { stockItemId: right.id })
        .expect(200)
    ).body as StockMovementView;
    expect(moved).toMatchObject({
      stockItemId: right.id,
      grams: take!.grams,
      kind: 'USED',
      product: take!.product,
      links: take!.links,
      moved: { from: `${studio.material.code} · Red` },
    });
    // The grams leave the first filament and come off the right one.
    expect((await lineOf(studio.material.id, 'Red')).stockGrams).toBe(
      wrong.stockGrams + used,
    );
    expect((await lineOf(other.material.id, 'Red')).stockGrams).toBe(
      right.stockGrams - used,
    );
    expect(await materialGrams(studio.material.id)).toBe(plaBefore + used);
    expect(await materialGrams(other.material.id)).toBe(petgBefore - used);
    // Its page says so.
    expect(
      (await as(admin.cookie).get(`/stock/movements/${take!.id}`).expect(200))
        .body,
    ).toMatchObject({ moved: { from: `${studio.material.code} · Red` } });

    // Nothing else may change, not even with the marker the move uses.
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('forgea.repointing', 'wrong-reel', true)`;
        await tx.stockMovement.update({
          where: { id: take!.id },
          data: { grams: -1, movedAt: new Date() },
        });
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.stockMovement.update({
        where: { id: take!.id },
        data: { stockItemId: wrong.id },
      }),
    ).rejects.toThrow(/append-only/);
  });

  it('a count is not moved: it stays where it was weighed', async () => {
    const line = await lineOf(studio.material.id, 'Red');
    await as(admin.cookie)
      .post('/stock/counts', {
        materialId: studio.material.id,
        colour: 'Red',
        gramsOnShelf: line.stockGrams + 7,
      })
      .expect(200);
    const [count] = (
      (
        await as(admin.cookie)
          .get(
            `/stock/movements?stockItemId=${line.id}&kinds=CORRECTION&limit=1`,
          )
          .expect(200)
      ).body as Page<StockMovementView>
    ).items;
    expect(count).toMatchObject({ kind: 'CORRECTION', movable: false });
    const right = await lineOf(other.material.id, 'Red');
    await as(admin.cookie)
      .post(`/stock/movements/${count!.id}/move`, { stockItemId: right.id })
      .expect(400);
  });

  it('a sweep weighs every filament at once and corrects only what differs', async () => {
    const red = await lineOf(studio.material.id, 'Red');
    const silk = await lineOf(studio.material.id, 'Copper silk');
    const otherRed = await lineOf(other.material.id, 'Red');
    await as(designer.cookie)
      .post('/stock/sweeps', {
        lines: [{ stockItemId: red.id, gramsOnShelf: 1 }],
      })
      .expect(403);
    await as(admin.cookie)
      .post('/stock/sweeps', {
        lines: [
          { stockItemId: red.id, gramsOnShelf: 1 },
          { stockItemId: red.id, gramsOnShelf: 2 },
        ],
      })
      .expect(400);
    const result = (
      await as(admin.cookie)
        .post('/stock/sweeps', {
          note: 'Monthly sweep',
          lines: [
            { stockItemId: red.id, gramsOnShelf: red.stockGrams - 30 },
            { stockItemId: silk.id, gramsOnShelf: silk.stockGrams + 12 },
            { stockItemId: otherRed.id, gramsOnShelf: otherRed.stockGrams },
          ],
        })
        .expect(200)
    ).body as { corrected: number; difference: number };
    expect(result).toEqual({ corrected: 2, difference: -18 });
    expect((await lineOf(studio.material.id, 'Red')).stockGrams).toBe(
      red.stockGrams - 30,
    );
    expect((await lineOf(studio.material.id, 'Copper silk')).stockGrams).toBe(
      silk.stockGrams + 12,
    );
    expect((await lineOf(other.material.id, 'Red')).stockGrams).toBe(
      otherRed.stockGrams,
    );
  });
});
