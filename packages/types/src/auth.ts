import type { Role } from './generated/prisma/enums.js';
import type { Permission, PermissionRole } from './permissions.js';

/** The signed-in user as the storefront sees them (GET /auth/me, and every sign-in). */
export interface Profile {
  id: string;
  email: string;
  name: string | null;
  /** Remembered from the last checkout. */
  phone: string | null;
  role: Role;
  emailVerified: boolean;
  /** False for a Google-only account (it can set one with "forgot your password"). */
  hasPassword: boolean;
  /** What they may do in the dashboard, read fresh on every request (empty for customers). */
  permissions: Permission[];
}

/** A team member's access, for the access page: their role's share and their own changes. */
export interface TeamAccess {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  disabled: boolean;
  rolePermissions: Permission[];
  granted: Permission[];
  denied: Permission[];
  permissions: Permission[];
}

/** The "Roles & permissions" page: what each role may do. */
export interface RolePermissionsView {
  role: PermissionRole;
  permissions: Permission[];
  /** Team members with this role, so the admin knows who a change reaches. */
  members: number;
}
