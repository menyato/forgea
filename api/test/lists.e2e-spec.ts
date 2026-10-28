import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Page, ProductListItem } from '@forgea/types';
import request from 'supertest';
import { AccessTokenService } from '../src/authorization/access-token.service.js';
import { ACCESS_COOKIE } from '../src/authorization/auth-cookies.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import { createApp, uniqueEmail } from './create-app.js';

describe('Lists and pagination (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  // Unique per run so repeated runs against the same test database don't interfere.
  const tag = `run${Date.now().toString(36)}`;
  const cookies: Partial<Record<Role, string>> = {};

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    const pla = await prisma.material.findUniqueOrThrow({
      where: { code: 'PLA' },
    });
    // Seven products, three sharing a name, so paging must break ties by id.
    const names = [
      'alpha',
      'bravo',
      'bravo',
      'bravo',
      'charlie',
      'delta',
      'echo',
    ];
    for (const [i, n] of names.entries()) {
      await prisma.product.create({
        data: {
          slug: `${tag}-${i}`,
          name: `${tag} ${n}`,
          description: 'test',
          grams: 60,
          printHours: 3,
          materialId: pla.id,
        },
      });
    }
    await prisma.product.create({
      data: {
        slug: `${tag}-hidden`,
        name: `${tag} hidden`,
        description: 'x',
        grams: 1,
        printHours: 0,
        materialId: pla.id,
        active: false,
      },
    });
    for (const role of [Role.ADMIN, Role.STAFF, Role.DESIGNER, Role.CUSTOMER]) {
      const user = await prisma.user.create({
        data: { email: uniqueEmail(role.toLowerCase()), role },
      });
      cookies[role] =
        `${ACCESS_COOKIE}=${await app.get(AccessTokenService).sign({ id: user.id, role })}`;
    }
  });
  afterAll(() => app.close());

  const get = (path: string, role?: Role) => {
    const req = request(app.getHttpServer()).get(path);
    return role ? req.set('Cookie', cookies[role]!) : req;
  };

  async function walk(
    query: string,
  ): Promise<{ items: ProductListItem[]; pages: number }> {
    const items: ProductListItem[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await get(
        `/products?q=${tag}&limit=2${query}${cursor ? `&cursor=${cursor}` : ''}`,
      ).expect(200);
      const page = res.body as Page<ProductListItem>;
      items.push(...page.items);
      cursor = page.nextCursor;
      expect(page.hasMore).toBe(cursor !== null);
      pages++;
    } while (cursor);
    return { items, pages };
  }

  it('pages through every active product exactly once (newest first by default)', async () => {
    const { items, pages } = await walk('');
    expect(pages).toBe(4);
    expect(items).toHaveLength(7);
    expect(new Set(items.map((p) => p.id)).size).toBe(7);
    expect(items.some((p) => p.name.endsWith('hidden'))).toBe(false);
    const times = items.map((p) => p.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('sorts by name with ties broken consistently, and prices every product', async () => {
    const { items } = await walk('&sort=name&order=asc');
    expect(items.map((p) => p.name.replace(`${tag} `, ''))).toEqual([
      'alpha',
      'bravo',
      'bravo',
      'bravo',
      'charlie',
      'delta',
      'echo',
    ]);
    // 60 g PLA, 3 h with the default settings → $13.91 (see docs/PRICING.md).
    expect(items[0]).toMatchObject({
      price: '13.91',
      material: { code: 'PLA' },
    });
  });

  it('filters by material', async () => {
    const res = await get(`/products?q=${tag}&material=PETG`).expect(200);
    expect(res.body).toEqual({ items: [], nextCursor: null, hasMore: false });
  });

  it('rejects a cursor used with a different sort, and invalid query values', async () => {
    const first = await get(`/products?q=${tag}&limit=2`).expect(200);
    await get(
      `/products?q=${tag}&limit=2&sort=name&cursor=${first.body.nextCursor}`,
    ).expect(400);
    await get('/products?limit=500').expect(400);
    await get('/products?sort=price').expect(400);
    await get('/products?status=PENDING').expect(400);
  });

  describe('access by role', () => {
    it.each([
      ['/orders', [Role.STAFF, Role.ADMIN], [Role.CUSTOMER]],
      ['/print-jobs', [Role.STAFF, Role.ADMIN], [Role.CUSTOMER]],
      ['/leads', [Role.STAFF, Role.ADMIN], [Role.DESIGNER, Role.CUSTOMER]],
      ['/audit-log', [Role.ADMIN], [Role.STAFF, Role.CUSTOMER]],
    ] as const)('%s', async (path, allowed, refused) => {
      await get(path).expect(401);
      for (const role of allowed) {
        const res = await get(`${path}?limit=5`, role).expect(200);
        expect(res.body).toEqual(
          expect.objectContaining({
            items: expect.any(Array),
            hasMore: expect.any(Boolean),
          }),
        );
      }
      for (const role of refused) await get(path, role).expect(403);
    });
  });

  it('the audit log lists recorded entries with their actor', async () => {
    const res = await get('/audit-log?limit=100', Role.ADMIN).expect(200);
    for (const entry of res.body.items) {
      expect(entry).toEqual(
        expect.objectContaining({
          action: expect.any(String),
          timestamp: expect.any(String),
        }),
      );
    }
  });
});
