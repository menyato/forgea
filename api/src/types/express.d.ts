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
      /** Verified Google ID-token claims, set by GoogleAuthGuard on the OAuth callback only. */
      googleClaims?: unknown;
    }
  }
}

export {};
