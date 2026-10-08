import type { Prisma } from "@acropora/database";

import { budapestToday } from "./quote-publish.service.js";

/**
 * AN EXPIRED QUOTE IS COMPUTED, NOT STORED (#1582 P8, plan C5): nothing
 * would move a stored EXPIRED (there is no scheduler). A quote is expired
 * when it is still open (DRAFT, SENT, POSTPONED) and its PUBLISHED version,
 * the one the customer has, was valid until a day before today (Budapest).
 * A quote with only a draft has nothing out that could expire.
 */
export const EXPIRABLE_STATUSES = ["DRAFT"] as const;

/** Today's start in Budapest, as the `validUntil` dates are stored. */
export function expiryCutoff(now = new Date()): Date {
  return new Date(`${budapestToday(now)}T00:00:00Z`);
}

export function expiredWhere(now = new Date()): Prisma.QuoteWhereInput {
  return {
    status: { in: [...EXPIRABLE_STATUSES] },
    versions: {
      some: { status: "PUBLISHED", validUntil: { lt: expiryCutoff(now) } },
    },
  };
}

export function isExpired(
  status: string,
  versions: ReadonlyArray<{ status: string; validUntil: Date }>,
  now = new Date(),
): boolean {
  const cutoff = expiryCutoff(now);
  return (
    (EXPIRABLE_STATUSES as readonly string[]).includes(status) &&
    versions.some((v) => v.status === "PUBLISHED" && v.validUntil < cutoff)
  );
}
