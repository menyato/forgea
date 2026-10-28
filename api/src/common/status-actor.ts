import type { Prisma } from '../generated/prisma/client.js';

/**
 * Tells the database triggers that write status history (orders: migration 20261026200000,
 * custom requests: 20261028090000) who is acting and why, for this transaction only.
 * Empty means "system". Call it inside the transaction that changes the status.
 */
export async function setStatusActor(
  tx: Prisma.TransactionClient,
  actorUserId: string | null,
  note: string | null,
): Promise<void> {
  await tx.$executeRaw`SELECT set_config('forgea.actor_id', ${actorUserId ?? ''}, true), set_config('forgea.status_note', ${note ?? ''}, true)`;
}
