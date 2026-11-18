/**
 * RELATÍV UT, NEM ALIAS: ez a modul spec-ből is behúzódik.
 */
import type { WorksheetVersionStatus } from "@acropora/types";

/**
 * EGY LEZÁRT LAP KIADOTT PDF-JÉNEK ÚJRAGENERÁLÁSA, A DÖNTÉSI RÉSZE (Balázs 2026-11-18 19:17 UTC, kártya 47e07a53; acrobot 56321).
 *
 * === MIÉRT KELL ===
 *
 * A kiadott lapot a lezárás (`close()`), az aláírás után pedig az aláírás tárolja, EGYSZER. A #2688 (élesben 2026-11-18 13:41 UTC) előtt lezárt lapokon a régi elrendezés áll
 * (a hosszú tárgy a számra csúszik, "Összes munkaóra: 0"), és magától soha nem frissül. A gomb ugyanabból a verzióból új bájtokat ír. Csak a MEGJELENÍTÉS változik: a verzió
 * tartalma, a tételek és az aláírás adata nem.
 *
 * === MIÉRT NEM ÚJ SOR ===
 *
 * A `WorksheetDocument` modellen `@@unique([worksheetVersionId, type])` áll, és ez SZERKEZETI (#847: "egy verzióhoz egy hiteles lap"): egy második kiadott sor az adatbázison
 * elhasalna, a megkötés lazítása pedig minden olvasót (csomag, partner, mobil) új szabályra kényszerítene. Ezért a sor MARAD (azonosító, verzió, típus, eredeti idő), és a TARTALMA
 * cserélődik; a régi bájtok egy ARCHÍV sorba kerülnek (`OTHER`, a lap csatolmányai között, verzióhoz kötés nélkül), a régi hashsel, az eredeti idővel és egy felirattal, amelyik
 * kimondja, mikor és ki generálta újra. Így a régi példány visszakereshető, és a hiteles-állítás sora egyetlen.
 */
export interface IssuedSheetRow {
  id: string;
  type: "GENERATED_SHEET" | "SIGNED_SHEET";
  fileName: string;
  sha256: string;
  createdAt: Date;
}

export type SheetRegenerationFailure =
  "NOT_CLOSED" | "NO_SHEET" | "SIGNED_SHEET_MISSING";

/** A tároló válasza: a `NOT_FOUND` a lekérdezésé, a `CONFLICT` a feltételes cseréé, a többi a döntési részé. */
export type RegenerateIssuedSheetResult =
  | { ok: true; changed: boolean }
  | {
      ok: false;
      reason: SheetRegenerationFailure | "NOT_FOUND" | "CONFLICT";
    };

export type SheetToRegenerate<T extends IssuedSheetRow> =
  { ok: true; row: T } | { ok: false; reason: SheetRegenerationFailure };

/**
 * MELY KIADOTT SORT ÍRJUK ÚJRA.
 *
 * - piszkozat verzió (`closedAt` nincs): a lap lezáráskor születik, nincs mit újragenerálni;
 * - aláírt verzió: a VÉGLEGES sor (az, amelyik az aláírást viseli, és amit a vevő kap). A lezáráskori sor ÉRINTETLEN marad: az az aláírás előtti állapotot rögzíti, és most
 *   aláírtként rajzolva olyan állapotot mutatna, amit sosem viselt. Ha a végleges sor hiányzik (a 2026-09-21 előtt aláírt lapoknál), az nem a lezáráskori sor átírásának oka, hanem
 *   a pótlás dolga (`worksheet-sheet-backfill`): kimondott hiba;
 * - egyéb lezárt verzió (aláírásra vár, elutasított): a lezáráskori sor.
 */
export function sheetToRegenerate<T extends IssuedSheetRow>(
  version: { status: WorksheetVersionStatus; closedAt: string | null },
  rows: readonly T[],
): SheetToRegenerate<T> {
  if (!version.closedAt) return { ok: false, reason: "NOT_CLOSED" };
  const wanted =
    version.status === "SIGNED" ? "SIGNED_SHEET" : "GENERATED_SHEET";
  const row = rows.find((candidate) => candidate.type === wanted);
  if (row) return { ok: true, row };
  return {
    ok: false,
    reason: version.status === "SIGNED" ? "SIGNED_SHEET_MISSING" : "NO_SHEET",
  };
}

const ARCHIVE_SUFFIX = " (korábbi elrendezés).pdf";
const CAPTION_LIMIT = 500;

/** A régi példány archív sora: név, felirat és az EREDETI idő (a dokumentum saját ideje, nem az újragenerálásé). */
export function archiveOfIssuedSheet(
  old: Pick<IssuedSheetRow, "fileName" | "createdAt">,
  regeneration: { at: string; byName: string },
): { fileName: string; caption: string; createdAt: Date } {
  const stem = old.fileName.replace(/\.pdf$/i, "").slice(0, 120);
  const head =
    "A lap korábbi elrendezésű PDF-je, az újragenerálás előtti példány. Újragenerálva: ";
  const tail = `${regeneration.at}, ${regeneration.byName.slice(0, 200)}.`;
  return {
    fileName: `${stem}${ARCHIVE_SUFFIX}`,
    caption: `${head}${tail}`.slice(0, CAPTION_LIMIT),
    createdAt: old.createdAt,
  };
}
