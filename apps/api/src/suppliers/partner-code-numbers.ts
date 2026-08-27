import type { Prisma } from "@acropora/database";

/**
 * A code that has already produced worksheet numbers is spent: it may not be
 * handed to anybody else, and its holder may not walk away from it.
 *
 * WHY THE CHECK IS THE OLD SEQUENCE TABLE, AND WHY THAT IS NOT A GATE THAT
 * WILL GO STALE. `WorksheetNumberSequence` holds the cursors of the numbers
 * that CARRIED the abbreviation (`FANK-BIO-2026-001`). Since 2026-08-27 the
 * number does not carry it any more and the counter is company-wide
 * (`WorksheetYearSequence`), so no new row appears here -- and none needs to.
 * The ambiguity this prevents can only come from the old-shaped numbers: those
 * name a partner by four characters, on paper that is already in a folder, and
 * they have to keep naming the same one forever. A sheet numbered under the new
 * shape says nothing about the abbreviation, so moving the code afterwards
 * makes no number ambiguous.
 *
 * The reason is therefore NOT the one that held before that change (that a
 * reused code would slide two partners' sheets into one series). There is one
 * series now. What is left is the paper.
 */
export async function assertPartnerCodeNeverNumbered(
  tx: Prisma.TransactionClient,
  code: string,
) {
  const numbered = await tx.worksheetNumberSequence.findFirst({
    where: { partnerCode: code },
    select: { partnerCode: true },
  });
  // No name to put in the message: the partner that used it may not even hold
  // it any more. Saying what the code DID is what ends the question here.
  if (numbered) throw new Error("PARTNER_CODE_USED_IN_NUMBERS");
}

/**
 * The other half of the same rule, in time rather than across partners: once a
 * code has numbered a sheet, its own holder cannot change or clear it either.
 * Without this the code could be vacated first and taken by somebody else on
 * the next save, and `assertPartnerCodeNeverNumbered` would be the only thing
 * standing in the way -- which is fine until someone decides a "free" code
 * should be re-usable.
 */
export async function assertPartnerCodeUnlocked(
  tx: Prisma.TransactionClient,
  currentCode: string,
) {
  const numbered = await tx.worksheetNumberSequence.findFirst({
    where: { partnerCode: currentCode },
    select: { partnerCode: true },
  });
  if (numbered) throw new Error("PARTNER_CODE_LOCKED");
}
