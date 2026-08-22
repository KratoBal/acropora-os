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
