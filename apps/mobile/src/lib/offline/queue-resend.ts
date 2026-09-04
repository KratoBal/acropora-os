/**
 * EGY ELAKADT FELVITEL JAVITASA ES UJRAKULDESE.
 *
 * === MI A BAJ MA, ES MIERT EZ AZ ELSO LEPES ===
 *
 * Egy `conflict` allapotu sornak MA NINCS KIJARATA. A szerelo latja a
 * sorban, olvassa a hibauzenetet, es nem tud vele csinalni semmit: a sor ott
 * marad a keszuleken, a szamlalo eg, es a kovetkezo kiuriteskor sem indul el
 * (helyesen -- ugyanaz a keres ugyanazt a valaszt kapna).
 *
 * KET KIJARAT LEHETSEGES, es a sorrendjuk NEM izles kerdese (acrobot dontese,
 * 2026-09-03): eloszor a JAVITAS ES UJRAKULDES, es csak azutan az ELVETES.
 * Ha az elvetes keszulne el eloszor, a keperno EGYETLEN gombja az lenne, hogy
 * a szerelo eldobja a sajat munkajat -- es a helyszinen siető ember meg is
 * nyomna, mert az van ott. A beirt adat NEMAN veszne el: a sor kiurul, a
 * keperno zold, es a munkalapon egyszeruen nem lesz ott, amit felvettek.
 * A forditott sorrendben a rosszabbik eset az, hogy egy utkozes BENT RAGAD,
 * amig az elvetes is meglesz -- az viszont LATHATO, es szolni fognak rola.
 *
 * === A MUVELET-AZONOSITO MEGMARAD, ES EZ MERVE VAN ===
 *
 * A sor kulcsa (`operationId`, egyben a szerver `clientOperationId` mezoje)
 * NEM valtozik a javitastol. Merve a szerveren 2026-09-03: a
 * `clientOperationId`-t a szerver CSAK SIKERES beszurasnal rogziti, es a
 * sajat kommentje ki is mondja, hogy egy matricakod-utkozes VALODI hiba,
 * nem idempotencia-talalat. Egy 409 utan tehat SEMMI nem jott letre, es a
 * kulcs szabad.
 *
 * AMIT EZ MEGNYER: a javitas nem torol sort, tehat NEM fugg az elvetestol --
 * a ket szelet fuggetlen. Es ha maga az ujrakuldes szakad meg, a
 * duplikacio-vedelem tovabbra is all. Uj kulcs TISZTABBNAK latszana, es
 * pontosan ezt a ket dolgot venne el.
 *
 * === A HATAR, AMI SZANDEKOS, ES AMEDDIG TART ===
 *
 * Ez a valtozat CSAK az ESZKOZ-felvitelt engedi javitani. Az indok nem
 * kenyelem: a valodi utkozes ott keletkezik (matricakod-utkozes, a szerver
 * szandekosan 409-cel valaszol ra). A MUNKALAP-felvitel ugyanugy elakadhat,
 * es addig lathato marad, de nem feloldhato.
 *
 * EZ NEM HIANY, HANEM IDOZITETT HATAR, es azert all itt kiirva, hogy a
 * kovetkezo olvaso ne hianynak nezze es ne irja meg megegyszer. Akkor esik ki,
 * amikor a munkalap-felvitel is kap szerkesztot -- vagy amikor kiderul, hogy
 * ott a gyakorlatban nem keletkezik utkozes, es akkor ez a sor marad, de az
 * indoka valtozik.
 *
 * === A TETELNEL AZ INDOK MAS, ES EZERT MAS A MONDAT IS ===
 *
 * A munkalap-TETEL (`worksheet-line`) sora ugyanugy nem javithato, de NEM
 * ugyanabbol az okbol, es egy kozos mondat itt HAZUDNA. A tetel konfliktusa
 * merve EGYFELE lehet: a szerver 409-et ad, ha a lap mar nem piszkozat
 * (`requireDraftVersionId`, illetve a `version-gone` ag). Merve 2026-09-04 a
 * `worksheets.service.ts`-ben: ezen az uton MAS conflict-forras nincs, a 422-t
 * pedig ez a modul sehol nem allitja elo.
 *
 * Vagyis a tetel torzsenek atirasa SEMMIN nem segitene: nem a szoveggel van
 * baj, hanem azzal, hogy a lap kozben lezarult. Az "ezt csak az irodabol lehet
 * feloldani" mondat itt azt igerne, hogy valaki mas majd atengedi -- pedig
 * lezart lapra tetel egyaltalan nem vehet fel. A kijarat az elvetes, es azt a
 * kepernyonek MEG KELL INDOKOLNIA (acrobot dontese, 2026-09-04).
 *
 * A tipusok SAJAT, szerkezeti alakok: ez a fajl a teszt-forditasba is bekerul,
 * az pedig nem ismeri az `@/` aliast. A fajta-listat viszont a `sync-queue.ts`
 * adja, relativ importtal: egy sajat masolat epp azt a nema elcsuszast hozna
 * vissza, ami ellen az a lista keszult.
 */

import {
  isSyncEntityType,
  isSyncOperation,
  type SyncEntityType,
  type SyncOperation,
} from "./sync-queue";

/** Amennyit egy sorbol ez a modul olvas. */
export interface ResendableRowLike {
  state: string;
  operation: string;
  entityType: string;
}

export type QueueResendRefusal =
  /** Nem elakadt sor: nincs mit feloldani rajta. */
  | "not-conflicted"
  /** Fenykep-sor: nincs szerkesztheto torzse. */
  | "not-a-create"
  /** Munkalap: a fenti idozitett hatar. */
  | "unsupported-entity";

export type QueueResendEligibility =
  { ok: true } | { ok: false; reason: QueueResendRefusal; message: string };

export function queueResendEligibility(
  row: ResendableRowLike,
): QueueResendEligibility {
  /**
   * A SORREND SZANDEKOS: eloszor az allapot, azutan a fajta.
   *
   * Egy VARAKOZO fenykep-sorrol ne azt mondjuk, hogy "nincs szerkesztheto
   * torzse" -- az igaz, de nem az a baja: egyszeruen meg el sem indult. Az
   * elso mondat, amit a szerelo lat, arrol szoljon, ami MOST all fenn.
   */
  if (row.state !== "conflict")
    return {
      ok: false,
      reason: "not-conflicted",
      message: "Ez a felvitel nem akadt el: nincs mit javítani rajta.",
    };

  if (row.operation !== "create") {
    /**
     * ISMERETLEN MUVELET: NEM JAVITHATO, es nem is talalgatunk rola. Ugyanaz
     * az ag, mint lentebb az ismeretlen fajtanal, ugyanabbol az okbol.
     */
    if (!isSyncOperation(row.operation))
      return {
        ok: false,
        reason: "not-a-create",
        message:
          "Ezt a sort ez a verzió nem ismeri, ezért nem tudja javítani. Frissítsd az appot, és ha marad, szólj.",
      };
    /**
     * MUVELETENKENT SAJAT MONDAT, ES EZT DRAGAN TANULTUK MEG EGY SORRAL LEJJEBB.
     *
     * Ez a feltetel korabban EGY mondatot adott mindenre, ami nem felvitel:
     * „Ez egy fénykép". Amint a modositas sora megjelent, az a mondat rola
     * HAMIS lett -- ugyanaz az alak, amit a `JAVITAS_ELUTASITAS` fejlece ir le
     * egy szinttel lejjebb, csak ott a FAJTA, itt a MUVELET a tengely.
     *
     * A `Record` miatt egy negyedik muvelet felvetele forditasi hiba, nem
     * csendes felreirat.
     */
    const muveletUzenet = JAVITAS_ELUTASITAS_MUVELET[row.operation];
    if (muveletUzenet !== null)
      return { ok: false, reason: "not-a-create", message: muveletUzenet };
  }

  /**
   * ISMERETLEN FAJTA: NEM JAVITHATO, es nem is talalgatunk rola.
   *
   * Ide egy UJABB valtozat altal irt sor eshet. A lekepezes lent KIMERITO
   * (`Record`), tehat ha az uj fajtat felvettuk a listara, ez az ag nem is
   * fut -- a fordito viszont KOVETELI, hogy a mondatat megirjuk.
   */
  if (!isSyncEntityType(row.entityType))
    return {
      ok: false,
      reason: "unsupported-entity",
      message:
        "Ezt a felvitelt ez a verzió nem ismeri, ezért nem tudja javítani. Frissítsd az appot, és ha marad, szólj.",
    };

  const elutasitas = JAVITAS_ELUTASITAS[row.entityType];
  if (elutasitas !== null)
    return { ok: false, reason: "unsupported-entity", message: elutasitas };

  return { ok: true };
}

/**
 * MUVELETENKENT MIERT NEM JAVITHATO -- `null`, ha javithato.
 *
 * A MODOSITAS AZERT NEM JAVITHATO A SOR-KEPERNYON, mert nem a szoveggel van
 * baj. A szerver akkor utasitja el, ha KOZBEN mas irta at UGYANAZOKAT a
 * mezoket: ilyenkor a torzs valtozatlan ujrakuldese ugyanezt adna vissza, es a
 * javito gomb egy soha nem teljesulo igeret lenne.
 *
 * A kijarat ma az, hogy a szerelo megnyitja az eszkozt, megnezi a MOSTANI
 * erteket, es ha a sajatja kell, ujra beirja. A „melyik ertek maradjon"
 * kepernyo kulon szelet -- amig nincs, ez a mondat mondja meg, mit lehet tenni,
 * es nem igeri, hogy majd valaki mas feloldja.
 */
const JAVITAS_ELUTASITAS_MUVELET: Record<SyncOperation, string | null> = {
  create: null,
  update:
    "Ezt a módosítást nem a szövege miatt utasította el a szerver, hanem azért, mert időközben más is átírta ugyanazokat a mezőket. Változatlanul újraküldve ugyanezt kapnád, ezért itt nincs javítás: a Feloldás gombbal mezőnként eldöntheted, melyik érték maradjon.",
  "upload-photo":
    "Ez egy fénykép, nincs mit átírni rajta. A képet a rögzítés után lehet újra feltölteni.",
};

/**
 * FAJTANKENT MIERT NEM JAVITHATO -- `null`, ha javithato.
 *
 * `Record`, nem `if`-lanc: egy uj fajta felvetele igy FORDITASI HIBAT ad. Egy
 * `!== "asset"` alaku feltetel mellett minden uj fajta MAGATOL a munkalap
 * mondatat kapta volna meg, es az a mondat rola HAMIS -- pontosan az a nema
 * visszaeses, amit a `sectionOf` fuggvenynel mar egyszer megmertunk.
 */
const JAVITAS_ELUTASITAS: Record<SyncEntityType, string | null> = {
  asset: null,
  worksheet:
    "Ezt a felvitelt egyelőre csak az irodából lehet feloldani. Szándékos szűkítés: ma az eszköz-felvitel javítható a telefonon.",
  "worksheet-line":
    "Ezt a tételt nem a szövege miatt utasította el a szerver, hanem azért, mert a munkalap időközben lezárult, és lezárt lapra tétel nem vehető fel. Átírni tehát nincs mit rajta: vagy az irodában nyitnak új verziót a lapból, vagy elveted. Amit beírtál, addig itt marad.",
};

/** Amit az ujrakuldes a soron megvaltoztat. */
export interface QueueResendPatch {
  payloadJson: string;
  state: "pending";
  attemptCount: 0;
  lastError: null;
}

/**
 * A JAVITOTT SOR ALLAPOTA.
 *
 * A KISERLETSZAM NULLAZODIK, es ez nem kozombos: a sor a szerver-hibak miatt
 * MAR GYUJTOTT kiserleteket, es ha azok megmaradnanak, a javitott felvitel
 * egy-ket probalkozas utan azonnal a megallasi hatarba futna -- ugy, hogy
 * kozben MAS torzset kuld, mint amivel a hibak keletkeztek. Az uj torzs uj
 * felvitel a szerver szemszogebol; a regi kiserletek rola semmit nem mondanak.
 *
 * A HIBAUZENET IS TORLODIK, ugyanabbol az okbol: egy megmarado `lastError` a
 * kepernyon a REGI bukast magyarazna egy MAR ATIRT sor mellett.
 *
 * A KULCS (`id`) NEM SZEREPEL ITT, es ez a lenyeg -- lasd a fejlecet.
 */
export function queueResendPatch(payloadJson: string): QueueResendPatch {
  return {
    payloadJson,
    state: "pending",
    attemptCount: 0,
    lastError: null,
  };
}

/**
 * A FELOLDAS MAS KERDES, MINT A JAVITAS, EZERT KULON DONTES.
 *
 * A javitas (`queueResendEligibility`) azt kerdezi: at lehet-e IRNI a torzset,
 * es ujra elkuldeni ugyanugy. Egy elakadt MODOSITASNAL ez nem mukodhet: a
 * torzsben allo `expectedUpdatedAt` vegleg elavult, tehat barmilyen szoveggel
 * ugyanazt a 409-et kapna vissza.
 *
 * A FELOLDAS azt kerdezi: MELYIK ERTEK MARADJON, mezonkent -- es a valaszbol
 * UJ torzs keszul, a FRISS verzioval. Ez az egyetlen ut, ami valoban at tud
 * menni.
 *
 * A KETTO KIZARJA EGYMAST, es ez nem izles: ha mindketto megjelenne ugyanazon a
 * soron, a szerelo a rossz gombot nyomna meg -- a javitas ott egy soha nem
 * teljesulo igeret lenne.
 */
export function queueResolveEligibility(
  row: ResendableRowLike,
): QueueResendEligibility {
  if (row.state !== "conflict")
    return {
      ok: false,
      reason: "not-conflicted",
      message: "Ez a sor nem akadt el: nincs mit feloldani rajta.",
    };

  if (row.operation !== "update")
    return {
      ok: false,
      reason: "not-a-create",
      message:
        "Ez nem módosítás, hanem felvitel vagy fénykép: nincs mit mezőnként eldönteni rajta.",
    };

  /**
   * MA CSAK ESZKOZ. A feloldo keperno az eszkoz mezoit ismeri (statusz,
   * kritikussag, helyszin, hat szoveges mezo), es egy masik fajtat NEM tudna
   * megmutatni. Ez idozitett hatar, nem hiany: amikor mas fajta is kaphat
   * `update` sort, ez a sor valtozik, es a mondat vele.
   */
  if (row.entityType !== "asset")
    return {
      ok: false,
      reason: "unsupported-entity",
      message:
        "Ezt a fajtát a feloldó képernyő még nem ismeri. Szándékos szűkítés: ma az eszköz módosítása oldható fel a telefonon.",
    };

  return { ok: true };
}
