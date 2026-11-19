import type { Prisma } from "@acropora/database";

/**
 * WHEN A WORKSHEET MAY BE LINKED TO A MAINTENANCE SHEET (card 5b366f5d). A LINK IS A REFERENCE: the worksheet stays where it
 * is, and it counts into no hours, price, settlement or invoice of the maintenance sheet. One pure function, so each refusal
 * is measured without a database and a planted break names the refusal that went missing.
 *
 *   job-not-maintenance   only a maintenance sheet takes links; a repair ticket has its own attach (`attachWorksheet`)
 *   job-has-no-partner    no customer, nothing to compare the worksheet's customer to
 *   other-customer        the worksheet belongs to another customer
 *   own-worksheet         the worksheet already lives under this very sheet: a link would be a second, redundant bond
 *   already-linked-here   linked to this sheet already
 *   linked-elsewhere      linked to ANOTHER maintenance sheet: one worksheet is counted at one sheet only
 */
export type LinkWorksheetRefusal =
  | "job-not-maintenance"
  | "job-has-no-partner"
  | "other-customer"
  | "own-worksheet"
  | "already-linked-here"
  | "linked-elsewhere";

export function linkWorksheetRefusal(input: {
  jobId: string;
  jobKind: "REPAIR" | "MAINTENANCE";
  jobCustomerId: string | null;
  worksheetCustomerId: string;
  /** The ticket or maintenance sheet the worksheet lives under (`Worksheet.serviceJobId`). */
  worksheetServiceJobId: string | null;
  /** The maintenance sheet the worksheet is already linked to, if any. */
  existingLinkJobId: string | null;
}): LinkWorksheetRefusal | null {
  if (input.jobKind !== "MAINTENANCE") return "job-not-maintenance";
  if (input.jobCustomerId === null) return "job-has-no-partner";
  if (input.worksheetCustomerId !== input.jobCustomerId)
    return "other-customer";
  if (input.worksheetServiceJobId === input.jobId) return "own-worksheet";
  if (input.existingLinkJobId === input.jobId) return "already-linked-here";
  if (input.existingLinkJobId !== null) return "linked-elsewhere";
  return null;
}

export const LINK_WORKSHEET_REFUSAL_MESSAGE: Record<
  LinkWorksheetRefusal,
  string
> = {
  "job-not-maintenance":
    "Munkalapot csak karbantartási laphoz lehet így hozzákapcsolni.",
  "job-has-no-partner": "Ehhez a karbantartási laphoz még nincs partner.",
  "other-customer":
    "Ez a munkalap másik partnerhez tartozik, mint a karbantartási lap.",
  "own-worksheet": "Ez a munkalap már ehhez a karbantartási laphoz tartozik.",
  "already-linked-here":
    "Ez a munkalap már hozzá van kapcsolva ehhez a karbantartási laphoz.",
  "linked-elsewhere":
    "Ez a munkalap már egy másik karbantartási laphoz van kapcsolva.",
};

/**
 * WHICH WORKSHEETS THE PICKER OFFERS (the filter half of the same rules, so the list and the endpoint cannot drift apart):
 * the customer's own, visible (not hidden) worksheets that do not live under this sheet and are not linked anywhere. The
 * endpoint re-checks on click (`linkWorksheetRefusal`), because time passes between the list and the click.
 */
export function linkableWorksheetWhere(input: {
  jobId: string;
  customerId: string;
}): Prisma.WorksheetWhereInput {
  return {
    customerId: input.customerId,
    hiddenAt: null,
    linkedToJob: null,
    OR: [{ serviceJobId: null }, { serviceJobId: { not: input.jobId } }],
  };
}

/** The note a link event carries: the worksheet as it was named at that moment (the number can be missing on a draft). */
export function linkEventNote(input: {
  number: string | null;
  subject: string;
}): string {
  const label = input.number ?? "számozatlan munkalap";
  return input.subject ? `${label}: ${input.subject}` : label;
}

/** The picker shows at most this many rows, and says so when more matched. */
export const LINKABLE_WORKSHEETS_PAGE = 50;
