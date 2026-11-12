import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { prisma, type Prisma } from "@acropora/database";

import {
  claimViewsWhere,
  type ManufacturerClaimView,
} from "../products/manufacturer-claims/manufacturer-claims.service.js";
import { lockContentItems } from "./content-row-lock.js";
import type { ContentState } from "./content-state.js";

/**
 * THE CONTENT ITEM AND THE MANUFACTURER CLAIMS IT STANDS ON (T5.3, point 3; the T5.1 content queue).
 *
 *   - an item names its claims before approval only: what the approver approved is what goes out,
 *     so the set does not change after it (`CLAIM_LINKABLE_STATES`);
 *   - approval (`AWAITING_APPROVAL -> READY_TO_SEND`) goes only when every named claim may go out
 *     (`claimApprovalRefusal`); a draft may hold unchecked claims, and the approver sees them;
 *   - a claim that drops out later sends the approved item back (`content-claim-stepback.ts`);
 *   - the affected-content list of a claim (point 4, "Érintett tartalmak") is `contentOfClaim`.
 */
export const CLAIM_LINKABLE_STATES: readonly ContentState[] = [
  "IDEA",
  "DRAFTING",
  "AWAITING_REVIEW",
  "AWAITING_REVISION",
  "AWAITING_APPROVAL",
];

/** The claims an item stands on, archived ones included (they block, and the approver must see why). */
export function claimsOfContent(
  contentId: string,
  db?: Prisma.TransactionClient,
): Promise<ManufacturerClaimView[]> {
  return claimViewsWhere({ contentLinks: { some: { contentId } } }, db);
}

/**
 * The sentence approval is refused with, or null. Any claim that may not go out as it stands
 * (unchecked, disputed, archived, its Product Knowledge fact changed) holds the approval.
 */
export function claimApprovalRefusal(
  claims: readonly ManufacturerClaimView[],
): string | null {
  const holding = claims.filter((claim) => claim.output.mode !== "PUBLISHABLE");
  if (!holding.length) return null;
  return `A tartalom nem hagyható jóvá, mert ${holding.length} gyártói állítása nem írható ki: ${holding
    .map(
      (claim) =>
        `"${claim.claimText.slice(0, 60)}" (${claim.id}, ${claim.output.reasons.join(", ")})`,
    )
    .join("; ")}. Előbb ellenőrizzétek, vagy vegyétek ki a tételből.`;
}

async function linkableItem(contentId: string) {
  const item = await prisma.contentItem.findUnique({
    where: { id: contentId },
    select: { state: true },
  });
  if (!item) throw new NotFoundException("A tartalom nem található.");
  if (!CLAIM_LINKABLE_STATES.includes(item.state))
    throw new ConflictException(
      "Gyártói állítást csak jóváhagyás előtt lehet a tételhez kötni vagy levenni róla: a jóváhagyott tétel azt viszi ki, amit jóváhagytak.",
    );
}

export async function linkClaim(input: {
  contentId: string;
  claimId: string;
  actorUserId: string;
}): Promise<ManufacturerClaimView[]> {
  await linkableItem(input.contentId);
  const claim = await prisma.productManufacturerClaim.findUnique({
    where: { id: input.claimId },
    select: { archivedAt: true },
  });
  if (!claim || claim.archivedAt)
    throw new BadRequestException("Az élő gyártói állítás nem található.");
  // THE STATE IS READ UNDER THE ROW LOCK (`content-row-lock.ts`): an approval running right now
  // holds the item, this waits, then sees READY_TO_SEND and refuses; and an approval that comes
  // after waits for this link and then reads it.
  await prisma.$transaction(async (tx) => {
    const state = (await lockContentItems(tx, [input.contentId])).get(
      input.contentId,
    );
    if (!state || !CLAIM_LINKABLE_STATES.includes(state))
      throw new ConflictException(
        "A tartalom közben jóváhagyásra került. Töltsd újra.",
      );
    await tx.contentItemClaim.upsert({
      where: {
        contentId_claimId: {
          contentId: input.contentId,
          claimId: input.claimId,
        },
      },
      create: {
        contentId: input.contentId,
        claimId: input.claimId,
        linkedById: input.actorUserId,
      },
      update: {},
    });
  });
  return claimsOfContent(input.contentId);
}

export async function unlinkClaim(input: {
  contentId: string;
  claimId: string;
}): Promise<ManufacturerClaimView[]> {
  await linkableItem(input.contentId);
  // Under the same row lock: an item approved in between keeps the claim it was approved on, so a
  // later dispute of that claim still finds it and steps it back.
  await prisma.$transaction(async (tx) => {
    const state = (await lockContentItems(tx, [input.contentId])).get(
      input.contentId,
    );
    if (!state || !CLAIM_LINKABLE_STATES.includes(state))
      throw new ConflictException(
        "A tartalom közben jóváhagyásra került. Töltsd újra.",
      );
    const { count } = await tx.contentItemClaim.deleteMany({
      where: { contentId: input.contentId, claimId: input.claimId },
    });
    if (!count)
      throw new NotFoundException("Ez az állítás nincs a tételhez kötve.");
  });
  return claimsOfContent(input.contentId);
}

/** "Érintett tartalmak" (point 4): every item that stands on the claim, with its state. */
export async function contentOfClaim(claimId: string) {
  const claim = await prisma.productManufacturerClaim.findUnique({
    where: { id: claimId },
    select: { id: true },
  });
  if (!claim) throw new NotFoundException("A gyártói állítás nem található.");
  const links = await prisma.contentItemClaim.findMany({
    where: { claimId },
    orderBy: { linkedAt: "asc" },
    select: {
      linkedAt: true,
      content: {
        select: {
          id: true,
          title: true,
          channel: true,
          state: true,
          plannedFor: true,
          scheduledFor: true,
          sentAt: true,
        },
      },
    },
  });
  return links.map(({ linkedAt, content }) => ({
    id: content.id,
    title: content.title,
    channel: content.channel,
    state: content.state,
    plannedFor: content.plannedFor?.toISOString() ?? null,
    scheduledFor: content.scheduledFor?.toISOString() ?? null,
    sentAt: content.sentAt?.toISOString() ?? null,
    linkedAt: linkedAt.toISOString(),
  }));
}
