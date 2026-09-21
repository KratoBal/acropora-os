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
 * NEM lát: a szerver külön, négyértékű állapotot és saját feliratot küld neki
 * (`partnerStatusLabel`), és az `apps/web` címke-táblájának fejléce ezt szó
 * szerint ki is mondja.
 *
 * A NAPLÓ-BEJEGYZÉS VISZONT CSAK A BELSŐ ÁLLAPOTOT HORDOZZA, a partneri
 * feliratot pedig a szerver számolja (`service-job-status.ts`), ahonnan ez a
 * csomag nem importálhat. Ezért ez a sor MEGNEVEZETLENÜL hagyja az állapotot.
 *
 * A TARTALOM LÉTEZIK, csak nincs honnan elérni: a partner letölthető
 * dokumentumcsomagja ugyanezt az eseményt MA IS a partneri felirattal írja ki
 * (`service-job-package.service.ts`). Ha a leképezés egyszer a
 * `@acropora/types`-ba kerül, ez a sor magától megnevezhetővé válik -- addig
 * egy megnevezetlen állapot pontosabb, mint egy olyan szó, amit a partnernek
 * nem szánunk.
 */
export function naploSor(entry: ServiceJobPartnerTimelineEntry): string {
  if (entry.kind === "status")
    /*
      AZ `isCreation` A BELSO ALLAPOT-NEV HELYETT (2026-09-21).

      Ez a sor korabban a `fromStatus === null` osszevetest vegezte -- vagyis a
      valasz a NYOLC ERTEKU BELSO enumot vitte a partnerhez, hogy aztan a
      kliens EGYETLEN bitet olvasson ki belole. A szerver mostantol azt az egy
      bitet kuldi.
    */
    return entry.event.isCreation
      ? "A hibajegy létrejött."
      : "A hibajegy állapota változott.";

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
