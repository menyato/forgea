import { Role } from '@forgea/types';

/** The roles a team member can have, in the order the forms offer them. */
export const TEAM_ROLES = [Role.STAFF, Role.DESIGNER, Role.ADMIN] as const;

export const ROLE_NAMES: Record<Role, string> = {
  [Role.ADMIN]: 'Admin',
  [Role.STAFF]: 'Staff',
  [Role.DESIGNER]: 'Designer',
  [Role.CUSTOMER]: 'Customer',
};

/** What each role means, for the role pickers. */
export const ROLE_LABELS: Record<Role, string> = {
  [Role.ADMIN]: 'Admin: everything, including money and the team',
  [Role.STAFF]: 'Staff: orders, production, sales and invoices',
  [Role.DESIGNER]: 'Designer: the catalog and request designs',
  [Role.CUSTOMER]: 'Customer',
};
