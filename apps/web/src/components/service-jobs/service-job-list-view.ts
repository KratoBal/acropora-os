/**
 * HOVÁ VISZ A KARBANTARTÁS-LISTA SORA: MINDIG A KARBANTARTÁSI LAPRA (Luca, 2026-11-18 14:43:46 UTC; acrobot 55968: „a karbantartási lapra kattintva ne a munkalapra vigyen, hanem
 * magára a lapra”). Az 55781-es kitérő (az egyetlen munkalapos sor a munkalapot nyitotta) megszűnt. A karbantartási lap nem hibajegy: a sor sosem a `/szerviz/hibajegyek` alá visz.
 */
export const maintenanceSheetHref = (job: { id: string }): string =>
  `/szerviz/karbantartas/${job.id}`;

/**
 * A KARBANTARTÁS LISTA FÜLEI A JELVÉNY LOGIKÁJÁVAL (Balázs, 2026-11-18 11:31 UTC; acrobot 56182): a karbantartásnak nincs hibajegy-állapota,
 * a "Kész" az, hogy van munkalapja, és mind alá van írva (`maintenanceDone`, a szerver számolja). A hibajegy fülei (Nyitott, Várakozik,
 * Lezárt) a háttérbeli státuszt szűrték, ezért a "Nyitott" fül alatt "Kész" jelvényű lap is állt (a stage-bejárás lelete).
 */
export type MaintenanceTab = "progress" | "done" | "all";

export const MAINTENANCE_TABS: { id: MaintenanceTab; label: string }[] = [
  { id: "progress", label: "Folyamatban" },
  // a közös szó (kártya 7f23785c, picasso 9. pont): a "Kész" helyett Lezárt; az azonosító marad, a mentett hivatkozások ugyanide visznek
  { id: "done", label: "Lezárt" },
  { id: "all", label: "Összes" },
];

/**
 * A FÜL TELJES SZÁMA A SZERVER SZÁMÁBÓL (f4590db6): a szerver szűr a fülre, és megmondja, hány lap van folyamatban és hány kész. A betöltött
 * sorok száma csak tartalék, ha a válasz (régi szerver) nem hozza.
 */
export function maintenanceTotal(
  counts: { progress: number; done: number } | undefined,
  tab: string,
  shown: number,
): number {
  if (!counts) return shown;
  if (tab === "done") return counts.done;
  if (tab === "progress") return counts.progress;
  return counts.progress + counts.done;
}
