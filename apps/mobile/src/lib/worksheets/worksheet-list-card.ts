/**
 * RELATIV UT, NEM `@/` ALIAS: ez a modul spec-bol is behuzodik.
 */
import {
  formatWorksheetQuantity,
  worksheetAssigneeLine,
} from "./worksheet-presentation";

/**
 * THE FIELDS THIS MODULE READS, declared here and not imported from
 * `lib/api/worksheets`: that module pulls the API client with `@/` paths
 * into the spec build, where they do not resolve (see `tsconfig.test.json`).
 * The list row is assignable to these shapes, so the screen passes it as is.
 */
interface CardRow {
  assigneeNames: string[];
  laborHours?: string;
  lineCount?: number;
}
type StatusCounts = Partial<
  Record<"DRAFT" | "AWAITING_SIGNATURE" | "SIGNED" | "REJECTED", number>
>;

/**
 * THE WORKSHEET CARD'S LINE (service redesign, Figma 423:904, 2026-10-04):
 * "Felelős: Ádám, Péter · 4 óra".
 *
 * The names are still `worksheetAssigneeLine` (the brief: keep it), now with
 * the "Felelős:" context in front. The hours follow the list row: a sheet
 * with no line yet shows a dash, and an older server that sends no hours
 * shows none, never "0 óra".
 */
export function worksheetCardMeta(item: CardRow): string {
  const parts = [`Felelős: ${worksheetAssigneeLine(item.assigneeNames)}`];
  if (item.laborHours !== undefined)
    parts.push(
      item.lineCount === 0
        ? "—"
        : `${formatWorksheetQuantity(item.laborHours)} óra`,
    );
  return parts.join(" · ");
}

/**
 * THE THREE TILES (Figma 423:904), from the server's counts: one "Új és
 * folyamatban" tile (decision E5; drafts are one status on the server),
 * "Elkészült" and "Lezárva". `null` without counts.
 */
export function worksheetStatTiles(
  counts: StatusCounts | undefined,
): { key: string; label: string; value: number }[] | null {
  if (!counts) return null;
  return [
    { key: "DRAFT", label: "Új és folyamatban", value: counts.DRAFT ?? 0 },
    {
      key: "AWAITING_SIGNATURE",
      label: "Elkészült",
      value: counts.AWAITING_SIGNATURE ?? 0,
    },
    { key: "SIGNED", label: "Lezárva", value: counts.SIGNED ?? 0 },
  ];
}
