/**
 * MIT LAT A SZERELO, AMIKOR EGY MODOSITAS NEM MENT FEL.
 *
 * === MIERT NEM ELEG AZ, AMI A FELVITELNEL ALL ===
 *
 * Az `offline-record.ts` mondatai a FELVITELROL szolnak: „a rögzítés
 * elveszett", „a felvitel vár feltöltésre". Egy modositasnal mindketto HAMIS
 * lenne. Az eszkoz ott van a rendszerben, es nem is veszett el semmi: a
 * JAVITAS nem ment fel. Egy „elveszett a rögzítés" mondat ilyenkor a
 * szerelovel azt hitetne el, hogy az eszkozt kell ujra felvinnie.
 *
 * === ES A HAROM BUKAS HAROM KULON MONDAT ===
 *
 * A sorba tetel harom kulon okbol bukhat el, es a TEENDO mindharomnal mas:
 *
 *   a keszulek taroloja hibas   -> ujra kell probalni, es szolni, ha ismetlodik
 *   az elozo modositas epp megy -> egy pillanat mulva ujra
 *   az elozo sor mar elakadt    -> a sor-kepernyon kell rendezni
 *
 * Egy kozos mondat mindharomra azt mondana, hogy „nem sikerult", es a szerelo
 * ugyanazt csinalna mindharomnal: megnyomna megegyszer. A masodiknal az helyes,
 * a harmadiknal SOHA nem fog sikerulni.
 */

import type { QueueWriteOutcome } from "../offline/save-or-queue";

export type { QueueWriteOutcome };

/**
 * A sorba tetel eredmenye emberi alakban.
 *
 * A HIBA SZOVEGE A TAROLOBOL JON, es nem talalgatunk belole: a `queue-store.ts`
 * a sajat okat adja vissza (`az előző módosítás állapota most: conflict`), es
 * azt idezzuk. Egy sajat besorolas itt a tarolo szovegenek MASODIK peldanya
 * lenne, es a ketto elcsuszhatna.
 */
export function describeAssetUpdateWrite(
  result: { ok: true; operationId: string } | { ok: false; error: string },
): QueueWriteOutcome {
  if (result.ok)
    return {
      type: "queued",
      operationId: result.operationId,
      /**
       * A MONDAT KIMONDJA, HOGY AZ ESZKOZ NEM VALTOZOTT MEG. Enelkul a szerelo
       * joggal hinne, hogy az iroda mar a javitott adatot latja -- pedig a
       * javitas a telefonon all, es percekig vagy orakig ott is marad.
       */
      message:
        "A módosítás a telefonon vár feltöltésre. Az eszköz adata a rendszerben addig a régi marad.",
    };
  return {
    type: "queue-failed",
    message:
      `A módosítást NEM sikerült elmenteni a telefonra (${result.error}). ` +
      "Az eszköz adata változatlan: próbáld újra, és ha ismétlődik, szólj.",
  };
}
