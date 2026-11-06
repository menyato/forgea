import type { Prisma } from '../generated/prisma/client.js';

/**
 * Claims a form's one-time key inside the transaction that records what the form says. True
 * the first time; false when the same form was already recorded (a double click, a retry):
 * the caller then records nothing. A second request with the key waits for the first's
 * transaction, so both can't pass. No key (an older form): always true.
 */
export async function claimRequestKey(
  tx: Prisma.TransactionClient,
  key: string | undefined,
  scope: string,
): Promise<boolean> {
  if (!key) return true;
  const claimed = await tx.$queryRaw<{ key: string }[]>`
    INSERT INTO "request_keys" ("key", "scope") VALUES (${key}::uuid, ${scope})
    ON CONFLICT ("key") DO NOTHING
    RETURNING "key"`;
  return claimed.length === 1;
}
