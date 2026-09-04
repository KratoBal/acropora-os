/**
 * A MUNKALAP ALAIRASA A HELYSZINEN.
 *
 * === KI IR ALA: AZ UGYFEL EMBERE (Balazs, 2026-09-04) ===
 *
 * A szerelo a lap partnerenek nyilvantartott munkatarsai kozul VALASZT, es az
 * ugyfel irja ala. Van egy "egyik sem" ertek: akkor a szerelo beirja a nevet,
 * DE A LAP EZT KIMONDJA -- a jelzes TAROLT allapot a soron (`signerSource`),
 * nem kepernyo-szoveg.
 *
 * === EZ ATIRJA A 2026-09-03-I ALAKOT, ES NEM SERTI ===
 *
 * Itt korabban az allt, hogy a lap a BEJELENTKEZETT felhasznalo (a szerelo)
 * neveben zarul, mert Balazs azt kerte, hogy "Ne kerje szovegkent" a nevet. Az
 * a mondat TILTAS volt a szabad szoveges mezore, es a mai alak teljesiti: a
 * legordulo all a szabad szoveg helyett, es a beiras KIVETEL, amit jelolunk.
 *
 * A regi valtozat mellett en irtam ide, hogy "ha kesobb megis kell az ugyfel
 * neve a lapon, az KULON MEZO lesz, nem ennek a felulirasa". Ez a mondat MA MAR
 * NEM ALL, es nem hagytam ott: nem kellett kulon mezo, mert a ket teny MAR
 * KULON OSZLOPBAN allt. A `signedByUserId` azt mondja meg, KI ROGZITETTE (a
 * szerelo, aki a telefont kezeli), a `signerName` azt, KI IRTA ALA.
 *
 * A webes felulet ugyanezt a szerzodest hasznalja, tehat a ket oldal jelentese
 * 2026-09-04 ota EGYSEGES.
 *
 * === MIERT KULON MODUL ===
 *
 * A kepernyore nincs komponens-teszt ebben az appban. Ami a torzsben marad, azt
 * csak kezzel, telefonon lehet kiprobalni -- egy alairas eseteben a helyszinen,
 * az ugyfel elott, ahol a javitas a legdragabb.
 *
 * A tipusok SAJAT, szerkezeti alakok: ez a fajl a teszt-forditasba is bekerul,
 * az pedig NEM ismeri az `@/` aliast (lasd `tsconfig.test.json` fejleceit).
 */

export type WorksheetSignatureDecision = "ACCEPTED" | "REJECTED";

export interface WorksheetSignatureForm {
  decision: WorksheetSignatureDecision;
  note: string;
  /** Az "egyik sem" agon beirt nev. Ures, ha listarol valasztottak. */
  typedName?: string;
  /**
   * AZ ALAIROKOD, amit az UGYFEL ir be. CSAK a listarol valasztott agon kell.
   *
   * Az "egyik sem" agon nincs, es ez NEM kiskapu: ott a lap MAGA MONDJA KI,
   * hogy nem a partner nyilvantartott munkatarsa irta ala. A kod hianya tehat
   * nem rejtve marad, hanem a dokumentum resze lesz.
   */
  signatureCode?: string;
}

export interface WorksheetSignaturePayload {
  decision: WorksheetSignatureDecision;
  /** A kod, ha listarol valasztott alairorol van szo. */
  signatureCode?: string;
  /**
   * A BEIRT NEV -- CSAK az "egyik sem" agon megy fel.
   *
   * Ha a szerelo listarol valasztott, a NEVET A SZERVER veszi a valasztott
   * sorbol, es ezt a mezot figyelmen kivul hagyja. Igy a lapra nem kerulhet mas
   * nev, mint akit valasztottak.
   */
  signerName?: string;
  /**
   * A VALASZTOTT MUNKATARS. `null` (illetve hianyzik) az "egyik sem" agon.
   *
   * A jelenlete donti el a szerveren, MELYIK agon ment az alairas -- a
   * `signerSource` erteket a szerver ebbol szamolja, nem a klienstol kerdezi.
   */
  signerUserId?: string;
  /** `null`, ha nincs megjegyzes -- a szerver is igy varja. */
  note: string | null;
}

export type WorksheetSignatureField = "signerName" | "note" | "signatureCode";

export type WorksheetSignatureResult =
  | { ok: true; payload: WorksheetSignaturePayload }
  | { ok: false; field: WorksheetSignatureField; message: string };

/** A szerver hatarai (`SignWorksheetVersionDto`), kezzel tukrozve. */
const SIGNER_NAME_MIN = 2;
const SIGNER_NAME_MAX = 200;
const NOTE_MAX = 1000;
/** Az elutasitas indokanak also hatara a SZOLGALTATASBAN all, nem a DTO-ban. */
const REJECTION_NOTE_MIN = 3;

/**
 * ALAIRHATO-E EZ A VERZIO EBBOL A KEPERNYOBOL.
 *
 * KET feltetel, es mind a ketto a szerveren is all: a verzio allapota
 * `AWAITING_SIGNATURE` (a `sign` mast elutasit), es a felhasznalonak van
 * `service.manage` joga. Ha a gomb ennel tagabban jelenne meg, olyat igerne,
 * amit a kereskor a szerver visszautasit -- ugy, hogy a szerelo mar odaadta a
 * telefont az ugyfelnek.
 */
export function canSignWorksheetVersion(input: {
  status: string;
  worksheetsManage: boolean;
}): boolean {
  return input.worksheetsManage && input.status === "AWAITING_SIGNATURE";
}

export const worksheetSignatureDecisionLabel: Record<
  WorksheetSignatureDecision,
  string
> = {
  ACCEPTED: "Elfogadom",
  REJECTED: "Nem fogadom el",
};

export function buildWorksheetSignaturePayload(
  form: WorksheetSignatureForm,
  /**
   * A VALASZTOTT MUNKATARS AZONOSITOJA, vagy `null` az "egyik sem" agon --
   * olyankor a `form.typedName` a nev.
   */
  signerUserId: string | null,
): WorksheetSignatureResult {
  const name = (form.typedName ?? "").trim();

  /**
   * AZ "EGYIK SEM" AGON A NEV KOTELEZO, ES ITT MAR URLAPHIBA -- a szerelo BE
   * TUDJA irni, tehat a mondat egy letezo mezore mutat.
   *
   * A LISTAROL VALASZTOTT AGON EZ AZ ELLENORZES KIMARAD, mert a nevet nem is a
   * kliens adja: a szerver a valasztott sorbol veszi. Egy itteni hossz-kapu
   * olyan erteket vizsgalna, ami fel sem megy.
   */

  if (!signerUserId) {
    if (name.length < SIGNER_NAME_MIN)
      return {
        ok: false,
        field: "signerName",
        message:
          "Válaszd ki az aláírót a listáról, vagy add meg a nevét legalább két karakterrel.",
      };
    if (name.length > SIGNER_NAME_MAX)
      return {
        ok: false,
        field: "signerName",
        message: `Az aláíró neve legfeljebb ${SIGNER_NAME_MAX} karakter lehet.`,
      };
  }

  const note = form.note.trim();

  /**
   * AZ ELUTASITAS OKA KOTELEZO (Balazs dontese, 2026-08-26), es a hatart a
   * SZERVER SZOLGALTATASA huzza meg, nem a DTO. A levagott hosszt nezzuk, mert
   * a csupa szokozbol allo indok pontosan annyit mond, mint a hianyzo.
   *
   * Ez a masolat NEM valtja ki a szerveret: azert all itt, hogy a szerelo a
   * valaszt AZONNAL lassa, ne egy korut utan, az ugyfel elott allva.
   */
  if (form.decision === "REJECTED" && note.length < REJECTION_NOTE_MIN)
    return {
      ok: false,
      field: "note",
      message:
        "Ha az ügyfél nem fogadja el a lapot, írd le miért, legalább három karakterrel.",
    };

  if (note.length > NOTE_MAX)
    return {
      ok: false,
      field: "note",
      message: `A megjegyzés legfeljebb ${NOTE_MAX} karakter lehet, most ${note.length}.`,
    };

  /**
   * A LISTAROL VALASZTOTT AGON A KOD KOTELEZO, ES AZ ALAKJAT ITT IS NEZZUK.
   *
   * A SORREND SZANDEKOS: EZ AZ UTOLSO KAPU. Az elotte allo mezoket a SZERELO
   * tolti ki (a nev az "egyik sem" agon, az elutasitas indoka), a kodot pedig
   * az UGYFEL -- es ertelmetlen odaadni neki a telefont azert, hogy utana a
   * szerelo sajat hianyzo mezoje alljon meg a mentest.
   *
   * A szerver ugyanezt ellenorzi, es a szerveré a dontő -- ez a masolat azert
   * all itt, hogy a szerelo a valaszt AZONNAL lassa, ne egy korut utan, az
   * ugyfel elott allva. Negy szamjegy, a kornyezo szokoz nem szamit: a telefon
   * billentyuzete konnyen ad egyet, es a felhasznalo szemszogebol az UGYANAZ a
   * kod.
   */
  if (signerUserId) {
    const code = (form.signatureCode ?? "").trim();
    if (!/^\d{4}$/.test(code))
      return {
        ok: false,
        field: "signatureCode",
        message:
          "Az aláírókód négy számjegy. Kérd meg az ügyfelet, hogy írja be.",
      };
  }

  return {
    ok: true,
    payload: {
      decision: form.decision,
      /**
       * CSAK AZ EGYIK MEZO MEGY FEL, es ez nem takarekossag: ha mind a ketto
       * ott allna, a szerver ket kulonbozo allitast kapna arrol, ki irta ala --
       * es a kliens dontene el, melyik nyer. Igy a szerver donti el, es a
       * lapra nem kerulhet mas nev, mint akit valasztottak.
       */
      ...(signerUserId
        ? { signerUserId, signatureCode: (form.signatureCode ?? "").trim() }
        : { signerName: name }),
      note: note ? note : null,
    },
  };
}

/** Amit a megerosito parbeszed kiir. */
export interface WorksheetSignatureConfirmation {
  title: string;
  message: string;
  confirmLabel: string;
}

/**
 * A MEGEROSITES SZOVEGE, ES MIERT VAN A TISZTA MODULBAN.
 *
 * Balazs kerese szerint (2026-09-03 19:42) az elfogadas EGY gomb plusz egy
 * megerosites. A megerosites viszont csak akkor er valamit, ha KIMONDJA, MI
 * TORTENIK -- egy "Biztos vagy benne?" annyit ker, hogy nyomd meg megegyszer,
 * es a masodik nyomast ugyanaz a kez vegzi, ugyanabban a masodpercben.
 *
 * A szoveg ezert nem a keperno torzseben all: ott semmi nem merne, es epp ez
 * az a resz, amit acrobot elore megnevezett, hogy konnyu elrontani.
 *
 * ES A KET AG KET KULONBOZO DOLGOT MOND, MERT KET KULONBOZO DOLOG TORTENIK.
 * Ezt lemertem a szerveren (`worksheet-amendment.ts`), nem feltetelezem:
 *
 *   ALAIRVA     vegleges. Az `amendRefusal` a `SIGNED` allapotra elutasitast
 *               ad, tehat a lap tobbe nem irhato at; a munka folytatasa UJ lap.
 *   ELUTASITVA  NEM vegleges. Ugyanaz a fuggveny `null`-t ad ra, vagyis az
 *               iroda atirhatja, es uj valtozat keszul belole.
 *
 * Egy kozos, altalanos mondat tehat az egyik agon hazudna.
 */
export function worksheetSignatureConfirmation(input: {
  decision: WorksheetSignatureDecision;
  signerName: string;
}): WorksheetSignatureConfirmation {
  if (input.decision === "REJECTED")
    return {
      title: "Rögzíted, hogy az ügyfél nem fogadta el?",
      message:
        `Feljegyezzük az indokot, és hogy ${input.signerName} rögzítette. ` +
        "Ezen a változaton több döntés nem születhet, de az iroda átírhatja, és új változat készül belőle.",
      confirmLabel: "Elutasítás rögzítése",
    };

  return {
    title: "Aláírod a munkalapot?",
    message:
      `A lap ${input.signerName} nevében zárul. ` +
      "A munkalap ezzel lezárul, és nem szerkeszthető tovább: a munka folytatása új lapra kerül.",
    confirmLabel: "Aláírom",
  };
}
