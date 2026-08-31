import type { AssetDeletionBlockers } from "@acropora/types";

/**
 * MI TARTJA VISSZA AZ ESZKOZ TORLESET.
 *
 * A HAROM SZAMLALO KULON ALL, ES EZ A LENYEG. Egy osszevont "van rajta valami"
 * ellenorzes csendben atengedne azt az esetet, ahol csak az EGYIK feltetel all:
 * ugyanaz a nulla jonne ki akkor is, ha a munkalap-agat elrontjuk, es akkor is,
 * ha a hibajegy-agat. Kulon szamlalokkal mind a haromra kulon allitas irhato, es
 * a hivo is meg tudja mondani a felhasznalonak, MI tartja vissza.
 *
 * A HIBAJEGY-FELTETEL MA MINDIG TELJESUL, es ezt ki kell irni, kulonben az elso
 * valodi hibajegynel derul ki, hogy sosem futott. Merve 2026-08-31: a
 * `ServiceJob` tabla LETEZIK a semaban, de a teljes `apps/api` forrasban NULLA
 * `serviceJob.create` hivas all, es egyetlen kontroller sem hivatkozik ra -- az
 * egyetlen olvasas egy `count` a partner torlesi tervben. Vagyis ma egyetlen sor
 * sem keletkezhet benne, tehat a szamlalo mindig nulla. A feltetel ettol nem
 * folosleges: a nap, amikor az elso hibajegy elkeszul, nem az a nap lesz, amikor
 * valaki eszebe jut visszajonni ide.
 *
 * A GYEREK-ESZKOZ A HARMADIK, ES EZ AZ EN OLVASATOM, NEM BALAZS SZAVA. O ket
 * feltetelt nevezett meg (hibajegy, munkalap). A semaban viszont a szulo-gyerek
 * kapcsolat `SetNull`, tehat egy szulo torlese NEM akad el: a gyerekek CSENDBEN
 * gyoker szintre kerulnek, es a felhasznalo csak annyit lat, hogy a fa szetesett.
 * Egy elmaradt torles panaszt szul, egy csendben szetesett eszkoz-fa viszont
 * olyan allapot, amit kezzel kell visszaepiteni. Bizonytalansagnal a szukebb
 * valasz all, es ez EGY SOR, ha Balazs mast mond.
 */
export function assetDeletionRefusal(
  blockers: AssetDeletionBlockers,
): string | null {
  const reasons: string[] = [];
  if (blockers.serviceJobs > 0)
    reasons.push(`${blockers.serviceJobs} hibajegy`);
  if (blockers.worksheetLines > 0)
    reasons.push(`${blockers.worksheetLines} munkalapsor`);
  if (blockers.childAssets > 0)
    reasons.push(`${blockers.childAssets} alárendelt eszköz`);
  if (reasons.length === 0) return null;
  return `Az eszköz nem törölhető, mert tartozik hozzá: ${reasons.join(", ")}.`;
}
