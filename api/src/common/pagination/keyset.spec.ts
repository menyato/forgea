import { BadRequestException } from '@nestjs/common';
import {
  decodeCursor,
  encodeCursor,
  keysetPage,
  type KeysetQuery,
} from './keyset.js';

interface Row {
  id: string;
  name: string;
}
const id = (n: number) =>
  `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

/** In-memory table that applies the same keyset filter Postgres would. */
function table(rows: Row[]) {
  const queries: KeysetQuery[] = [];
  const fetch = async (q: KeysetQuery) => {
    queries.push(q);
    const desc = q.orderBy[0] && Object.values(q.orderBy[0])[0] === 'desc';
    const cmp = (a: Row, b: Row) =>
      a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    const sorted = [...rows].sort((a, b) => (desc ? -cmp(a, b) : cmp(a, b)));
    const or = (
      q.after as {
        OR?: [
          { name: Record<string, string> },
          { name: string; id: Record<string, string> },
        ];
      }
    ).OR;
    const filtered = or
      ? sorted.filter((r) => {
          const [first, second] = or;
          const [op, v] = Object.entries(first.name)[0]!;
          const [, idv] = Object.entries(second.id)[0]!;
          const after = (x: string, y: string) => (op === 'gt' ? x > y : x < y);
          return (
            after(r.name, v) || (r.name === second.name && after(r.id, idv))
          );
        })
      : sorted;
    return filtered.slice(0, q.take);
  };
  return { fetch, queries };
}

const page = (
  fetch: ReturnType<typeof table>['fetch'],
  cursor?: string,
  order: 'asc' | 'desc' = 'asc',
) =>
  keysetPage<Row>(
    {
      sortField: 'name',
      kind: 'string',
      order,
      limit: 2,
      cursor,
      valueOf: (r) => r.name,
    },
    fetch,
  );

describe('keysetPage', () => {
  // Three rows share a name: only the id tie-breaker keeps them in a stable order.
  const rows = [
    { id: id(1), name: 'b' },
    { id: id(2), name: 'a' },
    { id: id(3), name: 'b' },
    { id: id(4), name: 'b' },
    { id: id(5), name: 'c' },
  ];

  it('walks every row exactly once, even with tied sort values', async () => {
    const { fetch } = table(rows);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const p = await page(fetch, cursor);
      seen.push(...p.rows.map((r) => r.id));
      cursor = p.nextCursor ?? undefined;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual([id(2), id(1), id(3), id(4), id(5)]);
  });

  it('works descending too', async () => {
    const { fetch } = table(rows);
    const first = await page(fetch, undefined, 'desc');
    const second = await page(fetch, first.nextCursor!, 'desc');
    expect([...first.rows, ...second.rows].map((r) => r.id)).toEqual([
      id(5),
      id(4),
      id(3),
      id(1),
    ]);
  });

  it('asks for one extra row and orders by the sort field then id', async () => {
    const { fetch, queries } = table(rows);
    await page(fetch);
    expect(queries[0]).toEqual({
      after: {},
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 3,
    });
  });

  it('returns no cursor on the last page', async () => {
    const { fetch } = table(rows.slice(0, 2));
    await expect(page(fetch)).resolves.toMatchObject({
      hasMore: false,
      nextCursor: null,
    });
  });
});

describe('cursor validation', () => {
  const valid = encodeCursor({
    s: 'createdAt',
    o: 'desc',
    v: '2026-10-26T10:00:00.000Z',
    id: id(1),
  });

  it('decodes a cursor for the same sort', () => {
    expect(decodeCursor(valid, 'createdAt', 'desc', 'date').value).toEqual(
      new Date('2026-10-26T10:00:00.000Z'),
    );
  });

  it('reads whole numbers back as numbers (Int columns refuse strings)', () => {
    const grams = encodeCursor({ s: 'grams', o: 'asc', v: '-600', id: id(1) });
    expect(decodeCursor(grams, 'grams', 'asc', 'int').value).toBe(-600);
  });

  it.each([
    ['another sort field', valid, 'name', 'desc', 'string'],
    ['another direction', valid, 'createdAt', 'asc', 'date'],
    ['garbage', 'bm90LWpzb24', 'createdAt', 'desc', 'date'],
    [
      'a bad date',
      encodeCursor({ s: 'createdAt', o: 'desc', v: 'never', id: id(1) }),
      'createdAt',
      'desc',
      'date',
    ],
    [
      'a bad decimal',
      encodeCursor({ s: 'total', o: 'desc', v: '1; drop', id: id(1) }),
      'total',
      'desc',
      'decimal',
    ],
    [
      'a fraction where whole numbers sort',
      encodeCursor({ s: 'grams', o: 'desc', v: '1.5', id: id(1) }),
      'grams',
      'desc',
      'int',
    ],
    [
      'a bad id',
      encodeCursor({ s: 'name', o: 'asc', v: 'x', id: "1' or 1=1" }),
      'name',
      'asc',
      'string',
    ],
  ] as const)('rejects %s', (_case, cursor, field, order, kind) => {
    expect(() => decodeCursor(cursor, field, order, kind)).toThrow(
      BadRequestException,
    );
  });
});
