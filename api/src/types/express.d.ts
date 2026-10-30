import type { Permission } from '@forgea/types';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';

declare global {
  namespace Express {
    // Passport types `req.user` as Express.User; make that our authenticated user.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends AuthenticatedUser {}

    interface Request {
      /** Resolved once per request by ClientIpMiddleware (Cloudflare-aware). */
      clientIp: string;
      /** Set by JwtAuthGuard from a valid access cookie. */
      user?: User;
      /** Set by PermissionsGuard on routes that need a permission: what the caller may do. */
      permissions?: Permission[];
      /** Verified Google ID-token claims, set by GoogleAuthGuard on the OAuth callback only. */
      googleClaims?: unknown;
    }
  }
}

export {};
