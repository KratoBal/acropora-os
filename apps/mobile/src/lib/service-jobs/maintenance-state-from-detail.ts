/**
 * RELATÍV UT, NEM `@/` ALIAS: ez a modul spec-ből is behúzódik (lásd a `tsconfig.test.json` fejlécét).
 */
import type { ServiceJobDetail } from "./types";

/**
 * A KARBANTARTÁS KÉSZSÉGE A MENTETT LISTASORHOZ, A RÉSZLETLAPBÓL (acrobot 56224).
 *
 * A részletlap menti vissza a listasort (`storeServiceJobDetail`), és a belső részletlap NEM küldi a `maintenanceDone` mezőt (a szerver csak a partner változatában számolja). A mentett sor mezője ezért elveszne, és egy
 * megnyitott kész lap az offline Folyamatban fülről az "ismeretlen" csoportba esne. A szabály ugyanaz, mint a szerveré: van munkalap, és mind aláírt.
 *
 * HA EGY LAP STÁTUSZA NINCS A RÉSZLETLAPON (egy régebben mentett lapnál hiányzik), a készség NEM kitalálható: a korábbi listasor értéke marad, és ha az sincs, a mező hiányzik (ISMERETLEN). A hibajegynek nincs készsége.
 */
export function maintenanceDoneFromDetail(
  detail: Pick<ServiceJobDetail, "kind" | "timeline">,
  previous: boolean | undefined,
): boolean | undefined {
  if (detail.kind !== "MAINTENANCE") return undefined;
  const sheets = detail.timeline.flatMap((entry) =>
    entry.kind === "worksheet" ? [entry.worksheet] : [],
  );
  if (sheets.length === 0) return false;
  if (sheets.some((sheet) => sheet.status === undefined)) return previous;
  return sheets.every((sheet) => sheet.status === "SIGNED");
}
