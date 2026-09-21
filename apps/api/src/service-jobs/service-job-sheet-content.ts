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
