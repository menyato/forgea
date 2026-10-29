import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { catchError, from, mergeMap, type Observable } from 'rxjs';
import type { Prisma } from '../generated/prisma/client.js';
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
 * Marks a sensitive admin/staff route. The AuditLog row (actor, target, client IP and what was
 * asked) is written BEFORE the handler runs: if it can't be written, nothing changes, so no
 * change is ever unlogged. A second row follows only when there is more to say: the id of
 * something just created, or that the change failed.
 */
export const Audit = (spec: AuditSpec) => SetMetadata(AUDIT, spec);

/** Request bodies larger than this are logged by their field names only. */
const MAX_LOGGED_BODY = 4000;
/** Never logged, whatever the route. */
const SECRET_FIELD = /password|secret|token|privatekey|private_key/i;

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
    const asked = targetIdAsked(req, spec);
    const entry = (targetId: string, metadata: Prisma.InputJsonObject) => ({
      actorUserId: req.user?.id ?? null,
      action: spec.action,
      targetType: spec.targetType,
      targetId,
      ipAddress: req.clientIp ?? null,
      metadata,
    });

    return from(
      this.audit.record(
        entry(asked, { request: summary(req.body as unknown) }),
      ),
    ).pipe(
      mergeMap(() => next.handle()),
      mergeMap(async (result: unknown) => {
        // The id the change ended up with, when the request didn't name it (something new,
        // or a value the API normalizes, e.g. a currency code in capitals).
        const final = spec.targetId ?? resultId(spec, result) ?? asked;
        if (final !== asked) {
          await this.audit.record(entry(final, { outcome: 'done' }));
        }
        return result;
      }),
      catchError(async (error: unknown) => {
        await this.audit
          .record(
            entry(asked, {
              outcome: 'failed',
              status: error instanceof HttpException ? error.getStatus() : 500,
            }),
          )
          .catch(() => undefined);
        throw error;
      }),
    );
  }
}

/** The target as the request names it, before anything runs ('new' when it doesn't). */
function targetIdAsked(req: Request, spec: AuditSpec): string {
  if (spec.targetId) return spec.targetId;
  const param: unknown = req.params[spec.targetParam ?? 'id'];
  return typeof param === 'string' ? param : 'new';
}

/** The target id the handler's result reports, if any. */
function resultId(spec: AuditSpec, result: unknown): string | undefined {
  const field = (key: string): string | undefined => {
    if (typeof result !== 'object' || result === null || !(key in result))
      return undefined;
    const value = (result as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
  };
  return spec.resultKey ? field(spec.resultKey) : field('id');
}

/** What was asked, without secrets; a big body (a catalog file) by its field names only. */
function summary(body: unknown): Prisma.InputJsonValue | null {
  if (typeof body !== 'object' || body === null) return null;
  const clean = JSON.parse(
    JSON.stringify(body, (key, value: unknown) =>
      SECRET_FIELD.test(key) ? '[hidden]' : value,
    ),
  ) as Prisma.InputJsonValue;
  return JSON.stringify(clean).length <= MAX_LOGGED_BODY
    ? clean
    : { fields: Object.keys(body), note: 'too large to keep in full' };
}
