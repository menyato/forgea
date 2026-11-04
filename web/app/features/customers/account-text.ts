import type { CustomerListItem } from '@forgea/types';

/** "Signs in with password and Google", "Account made by the studio", or "No account". */
export function accountText(c: CustomerListItem): string {
  if (!c.account) return 'No account';
  if (c.account.signIn.length === 0) return 'Account made by the studio';
  return `Signs in with ${c.account.signIn.join(' and ')}`;
}
