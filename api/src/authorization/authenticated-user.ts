import type { Role } from '../generated/prisma/enums.js';

/** Who is making the request, as proven by a valid access token. */
export interface AuthenticatedUser {
  id: string;
  role: Role;
}
