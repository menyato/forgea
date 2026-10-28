import type { Request } from 'express';

/** Where a sign-in came from; stored on the session and in audit entries. */
export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

export function requestContext(req: Request): RequestContext {
  const ua = req.get('user-agent');
  return {
    ip: req.clientIp ?? null,
    userAgent: ua ? ua.slice(0, 500) : null,
  };
}
