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
 * Ez a sor ezért MEGNEVEZETLENÜL hagyja az állapotot.
 *
 * === EZ A BEKEZDÉS 2026-09-21-EN ÁTÍRÓDOTT, MERT AZ INDOKA MEGVÁLTOZOTT ===
 *
 * KORÁBBAN az állt itt, hogy a napló-bejegyzés a BELSŐ állapotot hordozza, a
 * partneri feliratot pedig a szerver számolja, ahonnan ez a csomag nem
 * importálhat -- és hogy ha a leképezés egyszer a `@acropora/types`-ba kerül,
 * ez a sor magától megnevezhetővé válik.
 *
 * MA MIND A KÉT MONDAT HAMIS, két külön változás miatt:
 *
 *   1. A LEKÉPEZÉS MÁR A KÖZÖS CSOMAGBAN ÁLL (`partnerStatusLabel`, 2026-09-21).
 *      Tehát nem a hozzáférés hiányzik.
 *   2. A VÁLASZBÓL VISZONT ELTŰNT AZ ÉRTÉK: a partner saját napló-alakja
 *      (`ServiceJobPartnerStatusEvent`) `{ id, isCreation, actorName,
 *      createdAt }` -- állapot-mező NINCS benne. A szerver szándékosan nem
 *      küldi többé, épp azért, hogy a belső állapot ne jusson ki.
 *
 * VAGYIS A HIÁNY OKA MÁS LETT: nem a leképezést nem értük el, hanem a
 * MEGNEVEZENDŐ ÉRTÉK nincs a kezünkben. Ez a különbség nem szőrszálhasogatás:
 * az első feloldása egy import volt, a másodiké egy SZERVER-OLDALI döntés --
 * és az a döntés épp az ellenkező irányba mutat, mint amit ez a sor kérne.
 *
 * Amit tehát a következő olvasó tudjon: itt nincs elmaradt munka. Ha a
 * partnernek mégis meg kell tudnia, MILYEN állapotba lépett a jegy, az a
 * szerver válaszán múlik, nem ezen a fájlon.
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
