import type { Prisma } from "@acropora/database";

import { lockContentItems } from "./content-row-lock.js";

/**
 * WHEN A MANUFACTURER CLAIM DROPS OUT, THE CONTENT APPROVED ON IT GOES BACK TO APPROVAL (T5.3,
 * point 3: "minden hivatkozó tétel visszalép jóváhagyásra vár állapotba").
 *
 * A claim drops out when it becomes disputed or unchecked again (a status change or an edit of the
 * claim itself) or is archived. It runs in the claim write's own transaction, so the claim and the
 * content cannot disagree.
 *
 *   READY_TO_SEND   back to AWAITING_APPROVAL, with a state-log row naming the claim and why;
 *                   this is the only move outside `TRANSITIONS`, and only this function makes it
 *   SCHEDULED       NOT moved: the post stands on Facebook and goes out on its day whatever our
 *                   state says (`planTransition`, needs-external). A comment on the item says so,
 *                   and the affected-content list shows it
 *   SENT            NOT moved: it has gone out. A comment says the claim behind it dropped out
 *   anything else   not approved yet: the approval gate will stop it (`claimApprovalRefusal`)
 *
 * Its own file, not `content-claim-links.ts`: that one reads the claim views from the claims
 * service, and the claims service calls this one, so a shared file would be an import cycle.
 */
export async function stepBackContentOnClaimDrop(
  tx: Prisma.TransactionClient,
  input: { claimId: string; actorUserId: string; why: string },
): Promise<{ steppedBack: string[]; flagged: string[] }> {
  // THE LOCK BEFORE THE STATE (`content-row-lock.ts`): an approval running right now holds the
  // item; this waits for it, and then reads READY_TO_SEND and steps it back.
  const links = await tx.contentItemClaim.findMany({
    where: { claimId: input.claimId },
    select: { contentId: true },
  });
  const states = await lockContentItems(
    tx,
    links.map((link) => link.contentId),
  );
  const steppedBack: string[] = [];
  const flagged: string[] = [];
  for (const [id, state] of states) {
    if (state !== "READY_TO_SEND" && state !== "SCHEDULED" && state !== "SENT")
      continue;
    const content = { id, state };
    if (content.state === "READY_TO_SEND") {
      const { count } = await tx.contentItem.updateMany({
        where: { id: content.id, state: "READY_TO_SEND" },
        data: { state: "AWAITING_APPROVAL" },
      });
      if (count !== 1) continue;
      await tx.contentStateEvent.create({
        data: {
          contentId: content.id,
          fromState: "READY_TO_SEND",
          toState: "AWAITING_APPROVAL",
          actorUserId: input.actorUserId,
          note: `${input.why} (gyártói állítás ${input.claimId}): újra jóváhagyásra vár.`,
        },
      });
      steppedBack.push(content.id);
      continue;
    }
    await tx.contentComment.create({
      data: {
        contentId: content.id,
        authorId: input.actorUserId,
        body:
          content.state === "SCHEDULED"
            ? `${input.why} (gyártói állítás ${input.claimId}). A poszt ütemezve áll a Facebookon: ott kell visszavonni, a mi állapotunk ezt nem teszi meg.`
            : `${input.why} (gyártói állítás ${input.claimId}). A tétel már kiment: a javítás külön döntés.`,
      },
    });
    flagged.push(content.id);
  }
  return { steppedBack, flagged };
}
