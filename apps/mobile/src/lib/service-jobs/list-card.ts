/**
 * RELATIV UT, NEM `@/` ALIAS: ez a modul spec-bol is behuzodik (lasd a
 * `tsconfig.test.json` fejlecet).
 */
import type {
  ServiceJobListItem,
  ServiceJobListResponse,
  ServiceJobStatusValue,
} from "./types";

/**
 * THE JOB CARD OF THE SERVICE REDESIGN (Figma 423:876, Balázs, 2026-10-04):
 * "Felelős: Ádám, Péter · 2 ML · ma 08:14".
 *
 * Pure functions, because the phone's tests have no screen renderer.
 */

/**
 * THE THREE CASES OF THE ASSIGNEE LINE, AND WHY THEY ARE THREE.
 *
 * - names: "Felelős: Ádám, Péter";
 * - an empty list: "Felelős: nincs kiosztva", because the server said so;
 * - no field at all: "Felelős: nem ismert". The row was saved on the phone
 *   before the server sent assignees, so nobody knows; writing "nincs
 *   kiosztva" there would state something false (the brief, point 2).
 *
 * A PARTNER DOES NOT SEE THE LINE (decision of 2026-10-04): `null` when the
 * viewer is a partner user.
 */
export function serviceJobAssigneeLine(
  item: Pick<ServiceJobListItem, "assignees">,
  viewerIsPartner: boolean,
): string | null {
  if (viewerIsPartner) return null;
  if (item.assignees === undefined) return "Felelős: nem ismert";
  if (item.assignees.length === 0) return "Felelős: nincs kiosztva";
  return `Felelős: ${item.assignees.map((person) => person.name).join(", ")}`;
}

const MONTHS = [
  "jan.",
  "febr.",
  "márc.",
  "ápr.",
  "máj.",
  "jún.",
  "júl.",
  "aug.",
  "szept.",
  "okt.",
  "nov.",
  "dec.",
];

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "ma 08:14", "tegnap 15:42", or "okt. 2." for anything older. */
export function shortWhen(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const time = `${String(at.getHours()).padStart(2, "0")}:${String(
    at.getMinutes(),
  ).padStart(2, "0")}`;
  if (sameDay(at, now)) return `ma ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(at, yesterday)) return `tegnap ${time}`;
  const date = `${MONTHS[at.getMonth()]} ${at.getDate()}.`;
  return at.getFullYear() === now.getFullYear()
    ? date
    : `${at.getFullYear()}. ${date}`;
}

/** The card's last line: assignees, worksheets, when it was opened. */
export function serviceJobCardMeta(
  item: Pick<ServiceJobListItem, "assignees" | "worksheetCount" | "createdAt">,
  viewerIsPartner: boolean,
  now: Date,
): string {
  return [
    serviceJobAssigneeLine(item, viewerIsPartner),
    `${item.worksheetCount} ML`,
    shortWhen(item.createdAt, now),
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

const OPEN: ServiceJobStatusValue[] = [
  "NEW",
  "TRIAGED",
  "SCHEDULED",
  "IN_PROGRESS",
];
export const WAITING_STATUSES: ServiceJobStatusValue[] = [
  "WAITING_FOR_PARTS",
  "WAITING_FOR_CUSTOMER",
];
const CLOSED: ServiceJobStatusValue[] = ["COMPLETED", "CANCELLED"];

/**
 * THE THREE TILES (Nyitott, Várakozik, Lezárt), from the server's counts,
 * the same split as the web list. `null` without counts (a saved list or an
 * older server): the screen then draws no tiles rather than zeros.
 */
export function serviceJobStatTiles(
  counts: ServiceJobListResponse["counts"],
):
  | { key: "open" | "waiting" | "closed"; label: string; value: number }[]
  | null {
  if (!counts) return null;
  const sum = (statuses: ServiceJobStatusValue[]) =>
    statuses.reduce((total, status) => total + (counts[status] ?? 0), 0);
  return [
    { key: "open", label: "Nyitott", value: sum(OPEN) },
    { key: "waiting", label: "Várakozik", value: sum(WAITING_STATUSES) },
    { key: "closed", label: "Lezárt", value: sum(CLOSED) },
  ];
}
