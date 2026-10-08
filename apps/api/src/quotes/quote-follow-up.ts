import { Prisma } from "@acropora/database";

type Tx = Prisma.TransactionClient;

/**
 * A QUOTE'S FOLLOW-UP IS AN INTERNAL TASK (#1582 P8, plan 5.4; the issue's
 * point 20: no mail goes to the customer). The tasks land on Feladataim:
 *
 *   quote:<id>:after-send        FOLLOW_UP_AFTER_SEND_DAYS after the first
 *                                successful send;
 *   quote:<id>:before-expiry     FOLLOW_UP_BEFORE_EXPIRY_DAYS before the
 *                                sent version runs out (none if that is past);
 *   quote:<id>:postponed:<day>   on the day a postponed quote comes back.
 *
 * The key is `@@unique([source, sourceRef])`, so a second send, a resend or
 * a retry adds nothing (`skipDuplicates`). An acceptance, a rejection or a
 * cancellation closes every open one of the quote; a postponement closes
 * them and opens its own. A revoked acceptance does not reopen the closed
 * ones (known, decided: acrobot 28289).
 *
 * The two day counts are defaults nobody has decided yet (the issue says
 * "kiküldés után X nappal"); they stand here, in one place, to be changed.
 */
export const FOLLOW_UP_AFTER_SEND_DAYS = 5;
export const FOLLOW_UP_BEFORE_EXPIRY_DAYS = 3;

const DAY_MS = 86_400_000;

interface QuoteRef {
  id: string;
  quoteNumber: string;
  title: string;
  ownerUserId: string | null;
  createdById: string | null;
}

const prefix = (quoteId: string) => `quote:${quoteId}:`;
const link = (quoteId: string) => `/ajanlatok/${encodeURIComponent(quoteId)}`;
/** the quote's owner, else its creator, else whoever acted */
const assignee = (quote: QuoteRef, actorUserId: string) =>
  quote.ownerUserId ?? quote.createdById ?? actorUserId;

async function quoteRef(tx: Tx, quoteId: string): Promise<QuoteRef> {
  return tx.quote.findUniqueOrThrow({
    where: { id: quoteId },
    select: {
      id: true,
      quoteNumber: true,
      title: true,
      ownerUserId: true,
      createdById: true,
    },
  });
}

/** After a successful send: the two follow-ups, once per quote. */
export async function openSendFollowUps(
  tx: Tx,
  args: {
    quoteId: string;
    sentAt: Date;
    /** the sent version's last valid day, YYYY-MM-DD at 00:00 UTC */
    validUntil: Date;
    actorUserId: string;
  },
): Promise<void> {
  const quote = await quoteRef(tx, args.quoteId);
  const label = `${quote.quoteNumber} · ${quote.title}`;
  const beforeExpiry = new Date(
    args.validUntil.getTime() - FOLLOW_UP_BEFORE_EXPIRY_DAYS * DAY_MS,
  );
  const rows: Array<
    Pick<
      Prisma.TaskCreateManyInput,
      "title" | "description" | "dueAt" | "sourceRef"
    >
  > = [
    {
      title: `Ajánlat utánkövetése: ${label}`,
      description: `Kiküldve ${FOLLOW_UP_AFTER_SEND_DAYS} napja. Érdemes rákérdezni, megkapta-e és mit gondol.`,
      dueAt: new Date(
        args.sentAt.getTime() + FOLLOW_UP_AFTER_SEND_DAYS * DAY_MS,
      ),
      sourceRef: `${prefix(quote.id)}after-send`,
    },
  ];
  if (beforeExpiry > args.sentAt)
    rows.push({
      title: `Az ajánlat hamarosan lejár: ${label}`,
      description: `${FOLLOW_UP_BEFORE_EXPIRY_DAYS} nap múlva lejár az érvényessége.`,
      dueAt: beforeExpiry,
      sourceRef: `${prefix(quote.id)}before-expiry`,
    });
  await tx.task.createMany({
    data: rows.map((row) => ({
      ...row,
      source: "QUOTE",
      linkUrl: link(quote.id),
      assigneeId: assignee(quote, args.actorUserId),
      createdById: args.actorUserId,
    })),
    skipDuplicates: true,
  });
}

/**
 * A POSTPONED QUOTE COMES BACK ON ITS DAY, AND ONLY THEN (acrobot's #1636
 * decision): every follow-up still open (the send's two, an earlier
 * postponement's) is closed, and one opens for the new day. A second
 * postponement to the same day opens that day's task again: it is an upsert
 * on the key, since `skipDuplicates` would keep it closed.
 */
export async function openPostponedFollowUp(
  tx: Tx,
  args: { quoteId: string; until: Date; actorUserId: string },
): Promise<void> {
  const quote = await quoteRef(tx, args.quoteId);
  const day = args.until.toISOString().slice(0, 10);
  await closeFollowUps(tx, quote.id, args.actorUserId);
  const sourceRef = `${prefix(quote.id)}postponed:${day}`;
  await tx.task.upsert({
    where: { source_sourceRef: { source: "QUOTE", sourceRef } },
    update: {
      status: "OPEN",
      closedAt: null,
      closedById: null,
      dueAt: args.until,
    },
    create: {
      title: `Elhalasztott ajánlat: ${quote.quoteNumber} · ${quote.title}`,
      description: `Ma jár le a halasztás (${day}). Érdemes újra felvenni a kapcsolatot.`,
      dueAt: args.until,
      source: "QUOTE",
      sourceRef,
      linkUrl: link(quote.id),
      assigneeId: assignee(quote, args.actorUserId),
      createdById: args.actorUserId,
    },
  });
}

/** Accepted, rejected or cancelled: nothing is left to follow up. */
export async function closeFollowUps(
  tx: Tx,
  quoteId: string,
  /** null on the public link: the customer accepted, no user acted */
  actorUserId: string | null,
): Promise<number> {
  const closed = await tx.task.updateMany({
    where: {
      source: "QUOTE",
      sourceRef: { startsWith: prefix(quoteId) },
      status: "OPEN",
    },
    data: { status: "DONE", closedAt: new Date(), closedById: actorUserId },
  });
  return closed.count;
}
