/**
 * A KARBANTARTÁSI JEGYEN NINCS HIBAJEGY-KEZELÉS -- A SZERVER IS TARTJA (t-20261118-karbantartas-szerver-tiltas, acrobot 55837).
 *
 * Balázs döntése (2026-11-18 11:31 UTC): a karbantartásnak nincs hibajegy-állapotgépe, az ALÁÍRT MUNKALAP a kész. A felület (#2687,
 * #2689) ezért a `MAINTENANCE` jegyen elrejti az állapotváltást, a munkalap csatolását és leválasztását, a partner cseréjét, az
 * elrejtést és a partneres beszélgetést. Egy elrejtett gomb viszont nem tiltás: aki a végpontot közvetlenül hívja, eddig átjutott.
 *
 * AMI NEM TILTOTT, ÉS EZ SZÁNDÉKOS:
 *
 *   a Teljesítési igazolás     a karbantartáson MARAD (Balázs, 2026-10-15; emlék 2352)
 *   a jegy dokumentumai        (`:id/documents`, feltöltés, felirat, törlés) nyitva: a karbantartási lapon a „Fényképek és fájlok"
 *                              kártya megmarad (#2687 nem rejti, pilot-service-job-detail-page.tsx), oda kerülnek a helyszíni fotók
 *                              és a csatolmányok (barracuda kérdése a #2692-n)
 *   az elrejtés visszavonása   egy már elrejtett lap ne ragadjon be (murena javaslata, 55839)
 *   a rendszer saját lépése    a `MaintenanceOrdersService` belsőleg mond le egy tétel nélküli lapot (`ServiceJobsService.move`,
 *                              CANCELLED): ezért az őr a HTTP-BELÉPŐN áll (a vezérlőben), nem a `move()` belsejében
 *
 * TISZTA FÜGGVÉNY, hogy a szabály adatbázis nélkül mérhető legyen; a mondat a 409 üzenete.
 */
export type MaintenanceBlockedAction =
  | "move"
  | "attachWorksheet"
  | "detachWorksheet"
  | "setPartner"
  | "hide"
  | "partnerConversation";

const WHAT: Record<MaintenanceBlockedAction, string> = {
  move: "állapotváltás",
  attachWorksheet: "munkalap csatolása",
  detachWorksheet: "munkalap leválasztása",
  setPartner: "a partner cseréje",
  hide: "elrejtés",
  partnerConversation: "partneres beszélgetés",
};

/** A tiltás mondata, ha a művelet a jegy fajtáján nem végezhető; különben `null`. */
export function maintenanceBlock(
  kind: "REPAIR" | "MAINTENANCE" | null | undefined,
  action: MaintenanceBlockedAction,
): string | null {
  if (kind !== "MAINTENANCE") return null;
  return `Karbantartási munkán nincs ${WHAT[action]}: a karbantartási lapnak nincs állapota, az aláírt munkalap a kész.`;
}
