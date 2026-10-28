import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { OrderListQuery, ProductListQuery } from './index.js';

/** Query strings arrive as strings; same options as the API's ValidationPipe. */
function parse<T extends object>(
  cls: new () => T,
  query: Record<string, string>,
) {
  const dto = plainToInstance(cls, query);
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, fields: errors.map((e) => e.property).sort() };
}

describe('list queries', () => {
  it('applies defaults for the first page', () => {
    const { dto, fields } = parse(ProductListQuery, {});
    expect(fields).toEqual([]);
    expect(dto).toMatchObject({ limit: 20, order: 'desc', sort: 'createdAt' });
  });

  it('converts limit from the query string', () => {
    expect(parse(ProductListQuery, { limit: '50' }).dto.limit).toBe(50);
  });

  it.each([['0'], ['101'], ['2.5'], ['ten']])('rejects limit=%s', (limit) => {
    expect(parse(ProductListQuery, { limit }).fields).toEqual(['limit']);
  });

  it('rejects a malformed cursor, unknown sort and bad order', () => {
    expect(
      parse(ProductListQuery, {
        cursor: 'not/valid==',
        sort: 'price',
        order: 'up',
      }).fields,
    ).toEqual(['cursor', 'order', 'sort']);
  });

  it('validates filters against the shared enums', () => {
    expect(parse(OrderListQuery, { status: 'IN_PRODUCTION' }).fields).toEqual(
      [],
    );
    expect(parse(OrderListQuery, { status: 'SHIPPED_TO_MARS' }).fields).toEqual(
      ['status'],
    );
  });

  it('requires real ISO dates', () => {
    expect(
      parse(OrderListQuery, { from: '2026-10-01T00:00:00Z' }).fields,
    ).toEqual([]);
    expect(parse(OrderListQuery, { from: 'yesterday' }).fields).toEqual([
      'from',
    ]);
  });

  it('rejects filters that belong to another list', () => {
    expect(parse(ProductListQuery, { status: 'PENDING' }).fields).toEqual([
      'status',
    ]);
  });
});
