import type { WorksheetVersionStatus } from "@acropora/database";

/**
 * A HIBAJEGY ÉS A MUNKALAP ALÁÍRÁSÁNAK KÉT KAPUJA, EGY HELYEN.
 *
 * Balázs teljes specifikációja, 2026-09-18 18:06:13 UTC (Discord, Acropora OS
 * szál, message_id 1550568645871149187), szó szerint:
 *
 *   „Ha nem kerul ala munkalap, akkor lezarhato. Ha kerul ala munkalap, akkor
 *    csak ugy zarhato le ha a munkalap ala van irva. Es a fentiekbol kovetkezik,
 *    hogy munkalap sem irhato addig ala, amig nincs felette hibajegy."
 *
 * A KÉT SZABÁLY EGY MODULBAN ÁLL, MERT EGYMÁS FELTÉTELEI. A jegy kapuja azon
 * nyugszik, hogy az aláírás JELENT valamit; az aláírás kapuja azon, hogy nem
 * keletkezhet aláírás jegy nélkül. Külön fájlban a második szigorítása az
 * elsőt csendben tenné üressé.
 *
 * === A KÁRTYA CÍME EGY KORÁBBI, SZŰKEBB ALAKOT ŐRIZ ===
 *
 * A 391af0fc kártya címe „nincsenek lezárva a munkalapjai" alakban áll, Balázs
 * 17:54-es első mondatából. A 18:06-os teljes specifikáció ezt FELVÁLTJA:
 * a feltétel az ALÁÍRÁS, nem a lezárás. A kettő ma egybeesik az éles adaton
 * (mind a négy számozott lap SIGNED és van closedAt-ja), és a séma mégis külön
 * tartja őket -- ezért a kód az aláírásra néz. Aki a címből indul, egy másik
 * mezőre fog őrzőt írni, mint amiről a döntés szól.
 *
 * TISZTA FÜGGVÉNYEK, adatbázis nélkül mérhetők -- ugyanaz az alak, mint a
 * `worksheet-under-ticket.ts`-nél. A MONDATOT itt is a hívó adja: a jegy
 * kezelője és a lapot aláíró partner két különböző helyzetben áll, és egy
 * közös mondat vagy pontatlan lenne, vagy semmitmondó.
 */

/** Egy munkalap annyi állapota, amennyi a kapuhoz kell. */
export interface TicketWorksheetSignatureState {
  id: string;
  /** A lap száma, vagy `null`, ha még piszkozat-néven áll. */
  number: string | null;
  /**
   * A JELENLEGI (legmagasabb) verzió állapota, vagy `null`, ha nincs verzió.
   *
   * A „jelenlegi" itt ugyanazt jelenti, mint a repository többi helyén: a
   * `version` szerint csökkenő sorrend első eleme. Egy KORÁBBI verzió aláírása
   * nem elég: ha a lap azóta új verziót kapott, a mai tartalom aláíratlan.
   */
  currentVersionStatus: WorksheetVersionStatus | null;
  /** Rejtett-e a lap. MÉRVE VAN, de NEM mentesít -- lásd alább. */
  hidden: boolean;
  /**
   * RÖGZÍTETTE-E VALAKI, HOGY A LAP ÚTJA LEZÁRULT (`handedOverAt`).
   *
   * BOOLEAN, NEM DÁTUM, és ez szándékos: a kapunak a jelölés MEGLÉTE kell, a
   * dátum a megjelenítésé. Egy `Date | null` itt arra csábítana, hogy a
   * szabály az időponttal számoljon, és akkor a tiszta függvény egy órajelet
   * kapna bemenetnek.
   *
   * ÉS AMIT EZ NEM TUD: azt, hogy hol van a gép. Azt nem is tároljuk. Ezért
   * hívják jelölésnek, és ezért mondja a felhasználónak szóló szöveg, hogy az
   * átadás nincs rögzítve, nem azt, hogy az eszköz nálunk van -- helyszíni
   * munkánál az utóbbi hamis lenne.
   */
  handedOver: boolean;
}

/** Miért tart vissza egy lap. Laponként TÖBB ok is állhat egyszerre. */
export type TicketCloseBlockReason = "unsigned" | "not-handed-over";

/** Egy visszatartó lap, az OKAIVAL együtt. */
export interface BlockingWorksheet {
  sheet: TicketWorksheetSignatureState;
  reasons: TicketCloseBlockReason[];
}

/**
 * MELYIK MUNKALAP TARTJA VISSZA A JEGY LEZÁRÁSÁT, ÉS MIÉRT.
 *
 * A visszatérés LISTA, nem igen/nem, mert a hívónak meg kell neveznie a lapot.
 * Egy puszta „nem zárható le" a kezelőt keresésre küldi, és a jegy alatt akár
 * öt lap is állhat.
 *
 * ÉS LAPONKÉNT AZ OKOKAT IS ADJA, NEM CSAK A LAPOT. Amíg egyetlen feltétel
 * volt, a lap neve elég volt. Kettőnél nem: ha a hívó csak az első dobó
 * feltételt mondaná el, a kezelő megjavítaná, visszajönne, és a MÁSODIK
 * feltételen állna meg -- ugyanaz az út kétszer, és a második megállás
 * ugyanolyan indokolatlannak látszana, mint az első.
 *
 * === A REJTETT LAP IS VISSZATARTJA, ÉS EZ DÖNTÉS ===
 *
 * A rejtés MEGJELENÍTÉSI művelet: kiveszi a lapot a listákból. Ha egyben a
 * kaput is kinyitná, akkor egy nézet-kapcsolóból jogosultsági eszköz lenne, és
 * a legrosszabb fajta: CSENDES. Aki egy aláíratlan lapot elrejt, bezárhatná
 * fölötte a jegyet anélkül, hogy bárhol nyoma maradna, hogy a munka
 * aláírás nélkül zárult.
 *
 * A mérce nem az, hogy melyik eset a valószínűbb, hanem hogy melyik tévedés
 * marad rejtve. A fölösleges szigor HANGOS (valaki nem tud lezárni, és szól);
 * a fölösleges engedékenység NÉMA.
 *
 * ÉS VAN KIÚT, TEHÁT EZ NEM CSAPDA: a lap aláírható, megjelölhető átadottként,
 * vagy leválasztható a jegyről
 * (`DELETE /service/service-jobs/:id/worksheets/:worksheetId`). A rejtés maga
 * is visszavonható, a munkalap-listán a „Rejtettek is" jelölővel. Ezért a hívó
 * mondatának KI KELL MONDANIA, hogy a lap rejtett: a jegy alatti lista
 * szándékosan nem mutatja, tehát a kezelő hiába keresi ott.
 *
 * === A KÉT FELTÉTEL HATÓKÖRE KÜLÖNBÖZIK, ÉS EZ NEM ELGÉPELÉS ===
 *
 *   aláírás  CSAK a `COMPLETED` lépésre
 *   átadás   a `COMPLETED` ÉS a `CANCELLED` lépésre is
 *
 * Az aláírás a MUNKÁRÓL szól, ami elállt jegynél épp elmaradt -- nautilus
 * indoka (2026-09-18) változatlanul áll: egy tévedésből nyitott jegyet nem
 * szabad egy félig kitöltött lap miatt fogva tartani.
 *
 * Az átadás a GÉPRŐL szól, ami nem állt el. Ha elállunk, miközben a vevő
 * eszköze nálunk van, a jegy kikerül az aktív listából, és onnantól SEMMI nem
 * követi. A két tévedés ára itt fordítva áll: a fölösleges szigor hangos (a
 * kezelő nem tud elállni, és szól), a fölösleges engedékenység NÉMA.
 *
 * A „tévedésből nyitott jegy" esete tehát nem szorul ki, csak nem az
 * alapértelmezett úton megy: a lapot le kell választani róla.
 */
export function worksheetsBlockingTicketClose(input: {
  worksheets: readonly TicketWorksheetSignatureState[];
  to: "COMPLETED" | "CANCELLED";
}): BlockingWorksheet[] {
  const blocking: BlockingWorksheet[] = [];
  for (const sheet of input.worksheets) {
    const reasons: TicketCloseBlockReason[] = [];
    if (input.to === "COMPLETED" && sheet.currentVersionStatus !== "SIGNED")
      reasons.push("unsigned");
    if (!sheet.handedOver) reasons.push("not-handed-over");
    if (reasons.length) blocking.push({ sheet, reasons });
  }
  return blocking;
}

/**
 * === A HARMADIK KAPU: A CSOMAG ATADASA (80657ab7) ===
 *
 * Balazs dontese, 2026-09-21 11:56:49 UTC (Discord, fo csatorna, message_id
 * 1551562845588820019), szo szerint: „nem adunk at addig hibajegyet amig
 * nincs lezarva minden munkalap".
 *
 * A FAJL NEVE SZUKEBB, MINT A TARTALMA, es ez tudatos: ide azok a szabalyok
 * kerulnek, amik a jegy es a lapjai VISZONYAROL szolnak. Harom feltetel, ket
 * kulonbozo muveleten (allapot-lepes, csomag-atadas). Egy kulon fajl
 * ugyanazt a hibat hozna, amit a modul fejlece mar egyszer megnevez: a
 * szigoritas az egyik oldalon csendben tenne uresse a masikat.
 *
 * === AMIT EZ A KAPU MEGSZUNTET ===
 *
 * A csomag ma SZO NELKUL kihagyja azt a lapot, aminek a jelenlegi verziojahoz
 * nincs kiadott peldanya (`service-job-package.service.ts`, a `download()`
 * ciklusaban: `if (!document) continue;`). Balazs panasza 2026-09-18-an nem a
 * hianyzo lap volt, hanem hogy nem tudta, MIERT hianyzik.
 *
 * === KET OK, NEM EGY -- ES EZT MERNI KELLETT, NEM KIOLVASNI A SZOBOL ===
 *
 * A „lezaratlan" szo egyetlen feltetelt sugall. A kodban KETTO all, es a
 * TEENDOJUK KULONBOZIK:
 *
 *   not-closed        a jelenlegi verzio `closedAt`-ja ures. A kezelo MEG
 *                     TUDJA oldani: le kell zarni a lapot.
 *   no-issued-sheet   le VAN zarva, de a verziohoz nincs kiadott peldany. Ezt
 *                     a kezelo NEM tudja megoldani lezarassal -- a lap mar
 *                     zart --, ez belso hiany, potlast igenyel.
 *
 * MA A KETTO EGYUTT JAR, DE NEM UGYANAZ, ES VAN RA MERESUNK: a kiadott lap
 * eloallitasa a lezarasi tranzakcion BELUL fut, tehat uj lapnal nem valhatnak
 * szet. A kepesseg viszont 2026-09-18 14:09:31-kor olvadt be (#847), es
 * akkor az eles adatbazisban NEGY lezart munkalap allt NULLA kiadott
 * peldannyal -- pontosan ezert kellett a `worksheet-sheet-backfill`. Vagyis a
 * ket halmaz harom napja bizonyithatoan kulonbozott.
 *
 * Egy kozos „lezaratlan" ok tehat NEGY lapra azt allitotta volna, hogy nincs
 * lezarva, holott zart. A kezelo lezarni probalta volna, amit nem lehet.
 *
 * === A KET OK KIZARJA EGYMAST, ES EZ IS DONTES ===
 *
 * Egy le nem zart lapnak DEFINICIO SZERINT nincs kiadott peldanya. Ha
 * mindkettot jelentenenk, egy okrol ket mondat menne ki, es a masodik
 * felreviszi a kezelot. A `no-issued-sheet` tehat csak a MAR ZART lapokra
 * ertelmes.
 *
 * === A REJTETT LAP ITT MASKENT SZAMIT, MINT A LEZARASI KAPUNAL ===
 *
 * A lezarasi kapunal a rejtes NEM mentesit (lasd fent). Itt IGEN, de csak
 * partner-hivonal -- es nem engedmeny, hanem a csomag sajat hatokore: a
 * `download()` elso sora kihagyja a rejtett lapokat a partner csomagjabol
 * (`scope.kind !== "internal" && worksheet.hiddenAt !== null`). Egy kapu, ami
 * olyan lapon all meg, ami a hivo csomagjaba amugy sem kerulne bele, olyat
 * kerne szamon, amit a hivo nem is lathat.
 *
 * A KAPU TEHAT PONTOSAN AZT A HALMAZT NEZI, AMIT A CSOMAG OSSZERAKNA. Ez nem
 * stilus: igy nem keletkezik MASODIK fogalom arrol, hogy mi kerul a csomagba.
 */
export type PackageBlockReason = "not-closed" | "no-issued-sheet";

/** Egy munkalap annyi allapota, amennyi a csomag-kapuhoz kell. */
export interface PackageWorksheetState {
  id: string;
  /** A lap szama, vagy `null`. A mondat ezt nevezi meg. */
  number: string | null;
  hidden: boolean;
  /** A JELENLEGI verzio le van-e zarva (`closedAt`). */
  closed: boolean;
  /** Van-e a JELENLEGI verziohoz kiadott peldany. */
  hasIssuedSheet: boolean;
}

export interface BlockingPackageWorksheet {
  sheet: PackageWorksheetState;
  reason: PackageBlockReason;
}

/**
 * MELYIK MUNKALAP TARTJA VISSZA A CSOMAG ATADASAT.
 *
 * A `scope` NEM jogosultsagi dontes: azt mondja meg, MELYIK lapok kerulnenek
 * bele ennek a hivonak a csomagjaba. A jogosultsagot a hivo mar elvegezte.
 */
export function worksheetsBlockingPackage(input: {
  worksheets: readonly PackageWorksheetState[];
  scope: "internal" | "partner";
}): BlockingPackageWorksheet[] {
  const blocking: BlockingPackageWorksheet[] = [];
  for (const sheet of input.worksheets) {
    if (input.scope === "partner" && sheet.hidden) continue;
    if (!sheet.closed) blocking.push({ sheet, reason: "not-closed" });
    else if (!sheet.hasIssuedSheet)
      blocking.push({ sheet, reason: "no-issued-sheet" });
  }
  return blocking;
}

export type WorksheetSignatureCheck =
  { ok: true } | { ok: false; reason: "no-ticket" };

/**
 * ALÁÍRHATÓ-E EZ A MUNKALAP.
 *
 * NEM ÚJ DÖNTÉS: Balázs 2026-09-02 08:08-kor már kimondta (Munkalap folyamatok
 * szál), szó szerint: „ha egy Munkalapnak nincs hibajegye, akkor nem lehet
 * alairni, lezarni es nem keszulhet rola TIG, Szamla". A 2026-09-18-i
 * specifikáció ugyanezt mondja, ugyanabban a szerkezetben -- három hét
 * különbséggel. Megerősített szabály, nem friss ötlet.
 *
 * A DÖNTÉS MINDKÉT IRÁNYÁRA ÁLL (jóváhagyás és elutasítás), és ez szándékos:
 * jegy nélkül egy elutasításra sem vár senki. A `REJECTED` verzió egy olyan
 * folyamat lépése volna, ami el sem kezdődött.
 */
export function mayWorksheetBeSigned(input: {
  /** A lap fölötti hibajegy azonosítója, vagy `null`, ha nincs. */
  serviceJobId: string | null;
}): WorksheetSignatureCheck {
  if (input.serviceJobId === null) return { ok: false, reason: "no-ticket" };
  return { ok: true };
}
