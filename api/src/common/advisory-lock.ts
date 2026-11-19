import type { Prisma } from '../generated/prisma/client.js';

/**
 * Waits for, then holds until the transaction ends, the lock named `name` ("order:<id>",
 * "invoice:<id>"). Every service locking the same record must use this, so the same name is
 * always the same lock.
 */
export async function lock(
  tx: Prisma.TransactionClient,
  name: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${name}, 0))`;
}
