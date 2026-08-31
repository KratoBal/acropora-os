import type { WorksheetVersionStatus } from "@acropora/types";

export type AmendRefusal = "NOT_CLOSED" | "SIGNED";

/**
 * Whether a version may be amended, and if not, why.
 *
 * Kept out of the transaction so the rule can be read and tested on its own:
 * it is one line of policy in the middle of forty lines of bookkeeping, and it
 * changed once already -- a signed sheet used to be amendable, which put the
 * signature on a version nobody reads any more while the document it was given
 * for had quietly changed underneath it.
 */
export function amendRefusal(
  status: WorksheetVersionStatus,
): AmendRefusal | null {
  // Still a draft: there is nothing to amend, the draft itself is editable.
  if (status === "DRAFT") return "NOT_CLOSED";
  // Signed is final. The work continues on a new sheet that points back here.
  if (status === "SIGNED") return "SIGNED";
  return null;
}

/**
 * THIS RULE BRANCHES ON THE STATUS NAME, NOT ON WHETHER A SIGNATURE EXISTS -
 * and the two are not the same test. The card this came from was written as
 * "the boundary is the SIGNATURE, not the closing", which reads like a
 * restatement of the code above but is not: there is exactly one status where
 * the two formulations disagree.
 *
 * REJECTED. Measured in `WorksheetsRepository.sign`: when the customer refuses,
 * one transaction sets the version to REJECTED *and* creates a
 * `worksheetVersionSignature` row with `decision: "REJECTED"`. So a rejected
 * version DOES carry a signature, and it is amendable anyway.
 *
 * THAT IS DELIBERATE, NOT AN OVERSIGHT. A refusal means the customer asked for
 * a change, so amending is the normal continuation - the alternative would send
 * every disputed sheet onto a brand new worksheet, which is the harder path
 * exactly when the work has not changed. Whether that is right is a business
 * question and has not been put to the owner; what is written here is what the
 * code does and why it looks the way it does.
 *
 * IF IT EVER CHANGES, the change is one line above (REJECTED joins SIGNED) plus
 * a test - but the consequence is not one line: a rejected sheet would then have
 * to be continued on a new worksheet. Read that before editing, because the two
 * readings are easy to merge back together, and merging them silently is how
 * this distinction was nearly lost once already.
 */
