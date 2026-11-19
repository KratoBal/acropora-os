import { partnerStatusLabel } from "./service-job-status.js";

export interface ServiceJobSheetInput {
  jobNumber: string;
  status:
    | "NEW"
    | "TRIAGED"
    | "SCHEDULED"
    | "IN_PROGRESS"
    | "WAITING_FOR_PARTS"
    | "WAITING_FOR_CUSTOMER"
    | "COMPLETED"
    | "CANCELLED";
  customerName: string | null;
  departmentPath: readonly string[] | null;
  title: string;
  description: string | null;
  openedAt: Date;
  closedAt: Date;
  assets: readonly { assetNumber: string; assetName: string }[];
  assignees: readonly string[];
  photos?: readonly { thumbnail: Uint8Array; caption: string | null }[];
  /**
   * THE WORKSHEETS LINKED TO THIS MAINTENANCE SHEET (card 5b366f5d), or `undefined` for a sheet that takes no links (a repair
   * ticket: no empty section). References only: the section carries no hours and no price on purpose, and says so.
   */
  linkedWorksheets?: readonly {
    number: string | null;
    subject: string;
    createdAt: Date;
  }[];
  log: readonly { at: Date; text: string; authorName: string | null }[];
}

export interface ServiceJobSheetSection {
  title: string;
  lines: readonly string[];
}

const dateTime = new Intl.DateTimeFormat("hu-HU", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Europe/Budapest",
});

/**
 * WHICH LINKED WORKSHEETS THE VIEWER SEES ON THE SHEET: a worksheet hidden since it was linked is listed for an internal user
 * only, the same rule as the sheet's own worksheets in the package (`worksheetsBlockingPackage`, the zip loop). One function,
 * so the PDF list, the gate and the zip cannot drift apart.
 */
export function visibleLinkedWorksheets<T extends { hiddenAt: Date | null }>(
  linked: readonly { worksheet: T }[],
  internal: boolean,
): { worksheet: T }[] {
  return linked.filter(
    ({ worksheet }) => internal || worksheet.hiddenAt === null,
  );
}

const day = new Intl.DateTimeFormat("hu-HU", {
  dateStyle: "long",
  timeZone: "Europe/Budapest",
});

export function serviceJobSheetSections(
  input: ServiceJobSheetInput,
): readonly ServiceJobSheetSection[] {
  return [
    {
      title: "Bejelentés tárgya",
      lines: [input.title, input.description ?? "Nincs részletes leírás."],
    },
    {
      title: "Érintett eszközök",
      lines: input.assets.length
        ? input.assets.map(
            ({ assetNumber, assetName }) => `${assetName} · ${assetNumber}`,
          )
        : ["Nincs eszköz megjelölve."],
    },
    ...(input.linkedWorksheets === undefined
      ? []
      : [
          {
            title: "Kapcsolódó munkalapok (munkaóra és ár nélkül)",
            lines: input.linkedWorksheets.length
              ? input.linkedWorksheets.map(
                  ({ number, subject, createdAt }) =>
                    `${number ?? "számozatlan munkalap"}${subject.trim() ? ` · ${subject.trim()}` : ""} · ${day.format(createdAt)}`,
                )
              : ["Nincs kapcsolódó munkalap."],
          },
        ]),
    {
      title: "Delegáltak",
      lines: input.assignees.length
        ? input.assignees
        : ["Nincs delegált megjelölve."],
    },
    {
      title: "Jegynapló",
      lines: input.log.length
        ? input.log.map(
            ({ at, text, authorName }) =>
              `${dateTime.format(at)} · ${text}${authorName ? ` · ${authorName}` : ""}`,
          )
        : ["Nincs további naplóbejegyzés."],
    },
  ];
}

export function serviceJobSheetSummary(input: ServiceJobSheetInput) {
  return {
    status: partnerStatusLabel(input.status),
    customer: input.customerName ?? "Nincs partner megadva",
    department: input.departmentPath?.join(" / ") ?? "Nincs helyszín megadva",
    openedAt: dateTime.format(input.openedAt),
    closedAt: dateTime.format(input.closedAt),
  };
}
