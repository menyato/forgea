import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of, throwError } from 'rxjs';
import type { AuditEntry, AuditLogService } from './audit-log.service.js';
import {
  AUDIT,
  AuditInterceptor,
  type AuditSpec,
} from './audit.interceptor.js';

function setup(spec: AuditSpec | undefined, req: Record<string, unknown>) {
  const entries: AuditEntry[] = [];
  const audit = {
    record: (e: AuditEntry) => (entries.push(e), Promise.resolve()),
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
  it('records actor, action, target and IP after a successful handler', async () => {
    const { entries, ctx, interceptor } = setup(
      { action: 'order.status.change', targetType: 'Order' },
      {
        user: { id: 'staff-1', role: 'STAFF' },
        params: { id: 'order-9' },
        clientIp: '1.2.3.4',
      },
    );
    await firstValueFrom(
      interceptor.intercept(ctx, handlerReturning({ ok: true })),
    );
    expect(entries).toEqual([
      {
        actorUserId: 'staff-1',
        action: 'order.status.change',
        targetType: 'Order',
        targetId: 'order-9',
        ipAddress: '1.2.3.4',
      },
    ]);
  });

  it("falls back to the result's id when the route has no id param", async () => {
    const { entries, ctx, interceptor } = setup(
      { action: 'product.create', targetType: 'Product' },
      { user: { id: 'admin-1', role: 'ADMIN' }, clientIp: '1.2.3.4' },
    );
    await firstValueFrom(
      interceptor.intercept(ctx, handlerReturning({ id: 'prod-7' })),
    );
    expect(entries[0]?.targetId).toBe('prod-7');
  });

  it('records nothing when the handler fails', async () => {
    const { entries, ctx, interceptor } = setup(
      { action: 'x', targetType: 'Y' },
      { user: { id: 'a', role: 'ADMIN' }, clientIp: '1.2.3.4' },
    );
    const failing: CallHandler = {
      handle: () => throwError(() => new Error('boom')),
    };
    await expect(
      firstValueFrom(interceptor.intercept(ctx, failing)),
    ).rejects.toThrow('boom');
    expect(entries).toEqual([]);
  });

  it('ignores routes without @Audit()', async () => {
    const { entries, ctx, interceptor } = setup(undefined, {});
    await firstValueFrom(interceptor.intercept(ctx, handlerReturning(1)));
    expect(entries).toEqual([]);
  });
});

describe('AuditInterceptor resultKey', () => {
  it('takes the target id from the result when resultKey is set', async () => {
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
    expect(entries[0]?.targetId).toBe('LBP');
  });
});

describe('AuditInterceptor targetId', () => {
  it('uses the fixed target id for singletons', async () => {
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
    expect(entries[0]?.targetId).toBe('store');
  });
});
