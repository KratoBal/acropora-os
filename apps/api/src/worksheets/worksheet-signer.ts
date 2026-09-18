/**
 * KI IRTA ALA A LAPOT, ES MIT MOND EROL A LAP.
 *
 * === A DONTES, AMI EZT A MODULT LETREHOZTA ===
 *
 * Balazs, 2026-09-04: az alairo neve LEGORDULOBOL valaszthato a lap partnerenek
 * munkatarsai kozul; van egy "egyik sem" ertek, es akkor a szerelo irja be a
 * nevet -- DE AKKOR JELEZNI KELL, hogy nem az irta ala, akie a munkalap.
 *
 * A jelzes TAROLT allapot (`signerSource`), nem kepernyo-szoveg: egy kepernyore
 * irt mondat a kovetkezo valtozassal eltunik, a soron tarolt allapot megmarad.
 *
 * === HAROM ALLAPOT, NEM KETTO ===
 *
 *   SELECTED  a lap partnerenek munkatarsa irta ala, listarol valasztva
 *   TYPED     a szerelo irta be a nevet -- a lap ezt KIMONDJA
 *   null      2026-09-04 ELOTTI sor: akkor a `signerName` a mobilon a SZERELO
 *             nevet jelentette, a weben az ugyfelet. Visszamenoleg nem
 *             eldontheto, tehat a lap NEM ALLIT rola semmit.
 *
 * A harmadik allapotot kulon kell kezelni, es nem szabad a `TYPED` ala huzni:
 * az azt allitana egy regi lapról, hogy "nem az irta ala, akie a munkalap" --
 * holott lehet, hogy epp az.
 */

export type WorksheetSignerSource = "SELECTED" | "TYPED" | "INTERNAL";

/**
 * MIT MOND A LAP AZ ALAIRASROL -- `null`, ha nincs mit mondani.
 *
 * A MONDAT A SZERVEREN SZULETIK, es nem a kepernyokon: ket felulet (web es
 * mobil) olvassa, es a mobil nem tudja importalni a munkater csomagjait. Ket
 * masolat elcsuszna, es epp a JELZES az, aminek egyformanak kell lennie.
 */
export function describeSignerSource(
  source: WorksheetSignerSource | null,
): string | null {
  if (source === "SELECTED") return null;
  /**
   * A BELSOS ALAIRAS NEM KAP FIGYELMEZTETO MONDATOT, ES EZ NEM MULASZTAS.
   *
   * Ez a fuggveny arrol szol, amit a lap olvasojanak TUDNIA KELL AHHOZ, hogy ne
   * higgyen tobbet a kelletenel: a `TYPED` nevet nem ellenoriztuk, a `null`-rol
   * pedig nem tudjuk, melyik. A `SELECTED` es az `INTERNAL` viszont EGYARANT
   * azonositott alairo -- csak mas oldalrol.
   *
   * Hogy MELYIK oldalrol, azt a `worksheetSignerLabel` mondja meg, es az
   * MINDIG kiirodik. Egy figyelmeztetes itt azt sugallna, hogy a belsos alairas
   * gyengebb -- holott nevesitett felhasznalohoz kotott, szemben a kezzel
   * beirt nevvel.
   */
  if (source === "INTERNAL") return null;
  if (source === "TYPED")
    return (
      "A nevet a szerelő írta be: az aláíró NEM a munkalap partnerének " +
      "nyilvántartott munkatársa."
    );
  /**
   * A REGI SOR NEM ALLIT SEMMIT, es ezt is ki kell mondani. Egy nema regi sor
   * ugyanugy nez ki, mint egy `SELECTED` -- vagyis a hallgatas maga allitana
   * valamit, amit nem tudunk.
   */
  return (
    "Ez az aláírás a 2026-09-04-i változás előtt keletkezett, ezért nem tudjuk " +
    "megmondani, az ügyfél munkatársa vagy a szerelő neve áll rajta."
  );
}

/**
 * MIERT URES A LEGORDULO -- `null`, ha nem ures.
 *
 * KET KULONBOZO OK VAN, ES A TEENDOJUK MAS (acrobot kerese, 2026-09-04). Egy
 * nema ures lista MIND A KETTORE raillik, es a szerelo EGYIKET SEM tudja
 * megoldani a helyszinen; egy mondat viszont a helyes emberhez viszi.
 */
export function describeEmptySignerList(input: {
  /** A lap partnere szerepel-e a valaszthato szervizpartnerek kozott. */
  partnerSelectable: boolean;
  count: number;
}): string | null {
  if (input.count > 0) return null;
  if (!input.partnerSelectable)
    return (
      "Ehhez a partnerhez nem lehet munkatársat kötni, mert a partner nem " +
      "választható szervizpartner (nincs munkalap-rövidítése, vagy nem aktív). " +
      "Ez törzsadat-hiány: szólj az irodának."
    );
  return (
    "Ehhez a partnerhez még nincs hozzákötött munkatárs. Az irodában, a " +
    "felhasználó adatlapján lehet felvenni, a „Vevő nevében lép be” mezővel."
  );
}

/**
 * KI ÍRTA ALÁ -- ÉS MILYEN MINŐSÉGBEN. EZ A MONDAT MINDIG KIÍRÓDIK A LAPRA.
 *
 * === MIÉRT NEM ELÉG A NÉV (acrobot döntése, 2026-09-18 13:22) ===
 *
 * A lapon eddig ennyi állt: „Aláírta: <név>". Egy aláírt munkalap BIZONYÍTÉK,
 * és a puszta név az olvasóban ÜGYFÉL-aláírássá válik -- épp az a tévedés áll
 * elő, amit ki akarunk zárni, amikor a saját kollégánk írja alá.
 *
 * A három ág ezért három KÜLÖNBÖZŐ mondatot kap. Adat nem kell hozzá: a
 * `signerSource` már ma tárolva van.
 *
 * === EZ ÉS A `describeSignerSource` KÉT KÜLÖNBÖZŐ KÉRDÉS ===
 *
 * Ez azt mondja meg, KI írta alá, és MINDIG megjelenik. A másik azt, hogy mit
 * NEM tudunk az aláírásról, és csak akkor szólal meg, ha van mit mondani.
 * Ugyanazon az enumon állnak, ezért laknak egy fájlban: két modulban a
 * negyedik érték az egyikből kimaradna.
 */
export function worksheetSignerLabel(
  source: WorksheetSignerSource | null | undefined,
): string {
  switch (source) {
    case "SELECTED":
      return "Aláírta a partner munkatársa";
    case "TYPED":
      /**
       * A KÉZZEL BEÍRT NÉV KIMONDJA MAGÁT. A szerelő gépelte be, tehát a lap
       * nem állíthatja, hogy a partner nyilvántartott munkatársa volt.
       */
      return "Aláírta (a nevet a helyszínen írták be)";
    case "INTERNAL":
      return "Aláírta a szolgáltató munkatársa";
    default:
      /**
       * `null` VAGY ISMERETLEN. A régi sorok minősítés nélkül maradnak: a séma
       * saját megjegyzése szerint „egy kitalált érték rosszabb, mint egy
       * kétértelmű".
       *
       * ÉS AZ ISMERETLEN IS IDE ESIK, SZÁNDÉKOSAN: ha egyszer egy negyedik
       * érték kerül az enumba és ez a hely kimarad, a lap a SEMLEGES mondatot
       * írja, nem egy rosszat. Kimerítő-ellenőrzés helyett azért ez áll itt,
       * mert egy hibás minősítés a papíron rosszabb, mint egy hiányzó.
       */
      return "Aláírta";
  }
}
