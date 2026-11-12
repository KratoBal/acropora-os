import { Prisma } from "@acropora/database";

import type { ContentState } from "./content-state.js";

/**
 * THE ROW LOCK THE CLAIM PATHS SHARE (T5.3; barracuda's review of #2445). Approval, linking a claim
 * and the step-back of a dropped claim each read a content item's state and decide on it; without
 * a shared lock two of them can each see the other's "before" and both go through: an item
 * approved with an unchecked claim linked in the meantime, or with a claim disputed in the
 * meantime. Each path takes this lock FIRST in its transaction and reads the state from it, so the
 * second one waits for the first to commit and then sees what it did.
 *
 * Ordered by id: two transactions that lock several items lock them in the same order, so they
 * queue instead of deadlocking.
 */
export async function lockContentItems(
  tx: Prisma.TransactionClient,
  ids: readonly string[],
): Promise<Map<string, ContentState>> {
  if (!ids.length) return new Map();
  const rows = await tx.$queryRaw<{ id: string; state: ContentState }[]>`
    SELECT "id", "state"::text AS "state" FROM "ContentItem"
    WHERE "id" IN (${Prisma.join([...ids])})
    ORDER BY "id"`;
  return new Map(rows.map((row) => [row.id, row.state]));
}
