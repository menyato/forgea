import * as Shared from '@forgea/types';
import * as Prisma from '../generated/prisma/enums.js';

// Both copies come from the same Prisma schema. This fails if one generator output
// is stale (e.g. the schema changed and `pnpm generate` wasn't re-run), and it proves
// the API resolves the shared workspace package.
describe('@forgea/types enums', () => {
  it.each([
    'Role',
    'OrderStatus',
    'PaymentMethod',
    'PrintJobStatus',
    'CustomRequestStatus',
    'LeadSource',
    'ActivityKind',
    'QuotationStatus',
    'AccountType',
    'EntryType',
    'InvoiceKind',
  ] as const)('%s matches the API Prisma client', (name) => {
    expect(Shared[name]).toEqual(Prisma[name]);
  });
});
