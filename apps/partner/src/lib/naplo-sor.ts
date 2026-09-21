import {
  serviceJobWorksheetLabel,
  type ServiceJobPartnerTimelineEntry,
} from "@acropora/types";

/**
 * EGY NAPLÓSOR SZÖVEGE A PARTNER OLDALÁN.
 *
 * Tiszta függvény, hogy a mondat felépítése a képernyő felrajzolása nélkül is
 * mérhető legyen -- ugyanaz a megfontolás, ami a belső lap `timelineLine`
 * függvényét is kiemelte a komponensből.
 *
 * === EGYETLEN HELYEN TÉR EL A BELSŐ VÁLTOZATTÓL, ÉS AZ NEM ÍZLÉS ===
 *
 * Az állapotváltás sora a belső lapon a BELSŐ állapotot nevezi meg
 * (`Felmérve -> Alkatrészre vár`). A nyolc belső állapot az, amit a partner
 * NEM lát, és ezt az `apps/web` címke-táblájának fejléce szó szerint kimondja.
 * Ez a sor a NÉGYÉRTÉKŰ partneri feliratot nevezi meg helyette.
 *
 * === EZ A BEKEZDÉS KÉTSZER ÁTÍRÓDOTT EGY NAPON, ÉS A KETTŐ NEM UGYANAZ ===
 *
 * A sor sokáig MEGNEVEZETLENÜL hagyta az állapotot, és az indok kétszer
 * változott meg alatta -- mindkétszer úgy, hogy a kód egy betűt sem hibázott:
 *
 *   ELŐSZÖR a leképezés helye. Azt írta itt, hogy a partneri feliratot a
 *   szerver számolja (`service-job-status.ts`), ahonnan ez a csomag nem
 *   importálhat. Ez 2026-09-21 délelőttig igaz volt; akkor a leképezés
 *   átkerült a `@acropora/types`-ba, és a hozzáférés megszűnt akadálynak
 *   lenni.
 *
 *   AZTÁN az érték. A partner saját napló-alakja (`ServiceJobPartnerStatusEvent`)
 *   kivette a nyolcértékű enumot a válaszból -- helyesen --, és ettől a hiány
 *   FAJTÁJA változott meg: nem a leképezést nem értük el, hanem a megnevezendő
 *   érték nem volt a kezünkben. A kettő feloldása is más: az elsőé egy import,
 *   a másodiké SZERVER-OLDALI döntés.
 *
 * AZT A DÖNTÉST 2026-09-21 délután meghozták: a szerver a PARTNERI feliratot
 * odateszi a napló-eseményhez is (`partnerStatusLabel`). Így a sor megnevezi az
 * állapotot -- és a belső szókincs továbbra sem megy ki, mert nem is fér a
 * típusba.
 *
 * === AMIT A KÖVETKEZŐ OLVASÓ TUDJON ===
 *
 * A NÉGY FELIRAT DURVÁBB A NYOLCNÁL, és ez látszani is fog: a nyolc belső
 * állapotból ÖT ugyanarra a „Feldolgozás alatt" feliratra képződik. Egy jegy
 * naplójában tehát állhat két-három egymás utáni sor UGYANAZZAL a mondattal,
 * különböző időponttal és névvel. Ez nem hiba: a partner felől tényleg nem
 * változott semmi. Ha egyszer zavaró lesz, az ÖSSZEVONÁS termékdöntés, nem
 * ezé a függvényé -- és addig sem szabad csendben összevonni, mert az időpont
 * és a név soronként más.
 */
export function naploSor(entry: ServiceJobPartnerTimelineEntry): string {
  if (entry.kind === "status")
    /*
      KET MEZO, KET KULONBOZO KERDES (2026-09-21).

      Az `isCreation` a `fromStatus === null` osszevetes helyett all: a valasz
      korabban a NYOLC ERTEKU BELSO enumot vitte a partnerhez, hogy aztan a
      kliens EGYETLEN bitet olvasson ki belole. A szerver mostantol azt az egy
      bitet kuldi.

      A `partnerStatusLabel` MAS kerdesre felel: nem azt, hogy KELETKEZES-e,
      hanem hogy MILYEN allapotba lepett a jegy. A ketto kulon romlik el, ezert
      kulon allitas orzi oket.

      A KELETKEZES SORA IS MEGNEVEZI AZ ALLAPOTOT, holott ma az mindig "Uj" (a
      jegy egyetlen letrehozo utja `NEW` allapottal nyit). Szandekos: ha egyszer
      egy jegy mas allapotban szuletik, ez a sor HANGOSAN mast fog irni -- egy
      beegetett "Uj" szo ugyanott NEMAN tevedne.
    */
    return entry.event.isCreation
      ? `A hibajegy létrejött. Állapota: ${entry.event.partnerStatusLabel}.`
      : `A hibajegy állapota: ${entry.event.partnerStatusLabel}.`;

  if (entry.kind === "worksheet")
    return `Munkalap a jegy alatt: ${serviceJobWorksheetLabel(entry.worksheet)}`;

  /*
    A TÖRÖLT CSATOLMÁNY SORA MEGNEVEZI, KI VETTE LE, és mi volt az. Ez az
    egyetlen naplósor, ami VISSZAFORDÍTHATATLAN törlésről szól -- ott a "ki"
    nem kísérőadat. Név nélkül is olvasható marad: egy azóta törölt kolléga
    nem viszi magával a naplót.
  */
  if (entry.kind === "document") {
    const mi =
      entry.removal.documentType === "PHOTO"
        ? `fényképet (${entry.removal.fileName})`
        : `csatolmányt (${entry.removal.fileName})`;
    return entry.removal.actorName
      ? `${entry.removal.actorName} törölt egy ${mi}`
      : `Törölt ${mi}`;
  }

  return `Eszköz a jegyen: ${entry.asset.assetNumber} (${entry.asset.assetName})`;
}
