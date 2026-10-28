import type { Role } from './generated/prisma/enums.js';

/** The signed-in user as the storefront sees them (GET /auth/me, and every sign-in). */
export interface Profile {
  id: string;
  email: string;
  name: string | null;
  /** Remembered from the last checkout. */
  phone: string | null;
  role: Role;
}
