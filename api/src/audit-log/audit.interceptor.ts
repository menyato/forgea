import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { type Observable, mergeMap } from 'rxjs';
import { AuditLogService } from './audit-log.service.js';

export const AUDIT = 'forgea:audit';

export interface AuditSpec {
  action: string;
  targetType: string;
  /** Route param holding the target id; defaults to "id". Falls back to the result's `id`. */
  targetParam?: string;
  /** Take the target id from this field of the handler's result instead (normalized values). */
  resultKey?: string;
  /** A fixed target id, for singletons such as the store settings. */
  targetId?: string;
}

/**
 * Marks a sensitive admin/staff route. After the handler succeeds, an AuditLog row is
 * written with the actor, the target and the client IP — before the response is sent,
 * so a failed audit write fails the request instead of leaving an unlogged change.
 */
export const Audit = (spec: AuditSpec) => SetMetadata(AUDIT, spec);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditLogService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const spec = this.reflector.get<AuditSpec | undefined>(
      AUDIT,
      context.getHandler(),
    );
    if (!spec) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      mergeMap(async (result: unknown) => {
        await this.audit.record({
          actorUserId: req.user?.id ?? null,
          action: spec.action,
          targetType: spec.targetType,
          targetId: targetIdOf(req, spec, result),
          ipAddress: req.clientIp ?? null,
        });
        return result;
      }),
    );
  }
}

function targetIdOf(req: Request, spec: AuditSpec, result: unknown): string {
  if (spec.targetId) return spec.targetId;
  const fromResult = (key: string): string | undefined => {
    if (typeof result !== 'object' || result === null || !(key in result))
      return undefined;
    const value = (result as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
  };
  if (spec.resultKey) {
    const value = fromResult(spec.resultKey);
    if (value) return value;
  }
  const param: unknown = req.params[spec.targetParam ?? 'id'];
  if (typeof param === 'string') return param;
  return fromResult('id') ?? 'unknown';
}
