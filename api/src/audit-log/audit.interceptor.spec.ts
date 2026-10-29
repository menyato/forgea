import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of, throwError } from 'rxjs';
import type { AuditEntry, AuditLogService } from './audit-log.service.js';
import {
  AUDIT,
  AuditInterceptor,
  type AuditSpec,
} from './audit.interceptor.js';

function setup(
  spec: AuditSpec | undefined,
  req: Record<string, unknown>,
  record?: (e: AuditEntry) => Promise<void>,
) {
  const entries: AuditEntry[] = [];
  const audit = {
    record: record ?? ((e: AuditEntry) => (entries.push(e), Promise.resolve())),
  };
  const handler = () => undefined;
  if (spec) Reflect.defineMetadata(AUDIT, spec, handler);
  const ctx = {
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => ({ params: {}, ...req }) }),
  } as unknown as ExecutionContext;
  const interceptor = new AuditInterceptor(
    new Reflector(),
    audit as unknown as AuditLogService,
  );
  return { entries, ctx, interceptor };
}

const handlerReturning = (value: unknown): CallHandler => ({
  handle: () => of(value),
});

describe('AuditInterceptor', () => {
  it('records actor, action, target, IP and the request before the handler runs', async () => {
    const order: string[] = [];
    const { entries, ctx, interceptor } = setup(
      { action: 'order.status.change', targetType: 'Order' },
      {
        user: { id: 'staff-1', role: 'STAFF' },
        params: { id: 'order-9' },
        body: { status: 'READY', password: 'hunter2' },
        clientIp: '1.2.3.4',
      },
    );
    await firstValueFrom(
      interceptor.intercept(ctx, {
        handle: () => (
          order.push(`handler after ${entries.length} row`),
          of({ ok: true })
        ),
      }),
    );
    expect(order).toEqual(['handler after 1 row']);
    expect(entries).toEqual([
      {
        actorUserId: 'staff-1',
        action: 'order.status.change',
        targetType: 'Order',
        targetId: 'order-9',
        ipAddress: '1.2.3.4',
        metadata: { request: { status: 'READY', password: '[hidden]' } },
      },
    ]);
  });

  it('makes no change when the row cannot be written', async () => {
    let ran = false;
    const { ctx, interceptor } = setup(
      { action: 'product.update', targetType: 'Product' },
      { user: { id: 'admin-1' }, params: { id: 'p-1' }, clientIp: '1.2.3.4' },
      () => Promise.reject(new Error('database down')),
    );
    await expect(
      firstValueFrom(
        interceptor.intercept(ctx, { handle: () => ((ran = true), of(1)) }),
      ),
    ).rejects.toThrow('database down');
    expect(ran).toBe(false);
  });

  it("adds the result's id when the route has no id param (something created)", async () => {
    const { entries, ctx, interceptor } = setup(
      { action: 'product.create', targetType: 'Product' },
      { user: { id: 'admin-1', role: 'ADMIN' }, clientIp: '1.2.3.4' },
    );
    await firstValueFrom(
      interceptor.intercept(ctx, handlerReturning({ id: 'prod-7' })),
    );
    expect(entries.map((e) => [e.targetId, e.metadata])).toEqual([
      ['new', { request: null }],
      ['prod-7', { outcome: 'done' }],
    ]);
  });

  it('records that a change failed', async () => {
    const { entries, ctx, interceptor } = setup(
      { action: 'x', targetType: 'Y' },
      {
        user: { id: 'a', role: 'ADMIN' },
        params: { id: 't' },
        clientIp: '1.2.3.4',
      },
    );
    const failing: CallHandler = {
      handle: () => throwError(() => new Error('boom')),
    };
    await expect(
      firstValueFrom(interceptor.intercept(ctx, failing)),
    ).rejects.toThrow('boom');
    expect(entries.map((e) => e.metadata)).toEqual([
      { request: null },
      { outcome: 'failed', status: 500 },
    ]);
  });

  it('ignores routes without @Audit()', async () => {
    const { entries, ctx, interceptor } = setup(undefined, {});
    await firstValueFrom(interceptor.intercept(ctx, handlerReturning(1)));
    expect(entries).toEqual([]);
  });

  it('logs a large request by its field names only', async () => {
    const { entries, ctx, interceptor } = setup(
      { action: 'catalog.import', targetType: 'Catalog', targetId: 'catalog' },
      {
        user: { id: 'admin-1' },
        body: { products: 'x'.repeat(10_000), mode: 'add' },
        clientIp: '1.2.3.4',
      },
    );
    await firstValueFrom(interceptor.intercept(ctx, handlerReturning({})));
    expect(entries[0]?.metadata).toEqual({
      request: {
        fields: ['products', 'mode'],
        note: 'too large to keep in full',
      },
    });
  });
});

describe('AuditInterceptor resultKey', () => {
  it('records the normalized id from the result when resultKey is set', async () => {
    const { entries, ctx, interceptor } = setup(
      {
        action: 'currency.rate.set',
        targetType: 'Currency',
        resultKey: 'code',
      },
      {
        user: { id: 'admin-1', role: 'ADMIN' },
        params: { code: 'lbp' },
        clientIp: '1.2.3.4',
      },
    );
    await firstValueFrom(
      interceptor.intercept(ctx, handlerReturning({ code: 'LBP' })),
    );
    expect(entries.at(-1)?.targetId).toBe('LBP');
  });
});

describe('AuditInterceptor targetId', () => {
  it('uses the fixed target id for singletons, in one row', async () => {
    const { entries, ctx, interceptor } = setup(
      {
        action: 'store-settings.update',
        targetType: 'StoreSettings',
        targetId: 'store',
      },
      { user: { id: 'admin-1', role: 'ADMIN' }, clientIp: '1.2.3.4' },
    );
    await firstValueFrom(
      interceptor.intercept(
        ctx,
        handlerReturning({ transferPhone: '+961 70 904 044' }),
      ),
    );
    expect(entries.map((e) => e.targetId)).toEqual(['store']);
  });
});
