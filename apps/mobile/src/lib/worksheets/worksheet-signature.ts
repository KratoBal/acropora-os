/**
 * A MUNKALAP ALAIRASA A HELYSZINEN.
 *
 * === KI IR ALA: A SZERELO (Balazs dontese, 2026-09-03) ===
 *
 * A lap a BEJELENTKEZETT felhasznalo neveben zarul. A nevet a kepernyo NEM
 * engedi atirni, es a szerelo NEM az ugyfel nevet gepeli be.
 *
 * EZ A MI SZIGORITASUNK, NEM A SZERVERE. A `SignWorksheetVersionDto` ma is
 * szoveget ker (`signerName`, 2-200 karakter), tehat technikailag barmilyen nev
 * felmehetne. Ha kesobb megis kell az ugyfel neve a lapon, az KULON MEZO lesz,
 * nem ennek a felulirasa -- ezert nem a szerzodesbol vesszuk ki a mezot, hanem
 * a kepernyo nem engedi szerkeszteni.
 *
 * A webes felulet MASHOGY mukodik, es ez sem veletlen: ott az iroda rogziti az
 * ugyfel dontesét, tehat ott a nev szabad szoveg marad.
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

/** Amit a bejelentkezett felhasznalorol tudni kell ahhoz, hogy alairjon. */
export interface WorksheetSignerLike {
  displayName: string;
  nickname?: string | null;
}

export interface WorksheetSignatureForm {
  decision: WorksheetSignatureDecision;
  note: string;
}

export interface WorksheetSignaturePayload {
  decision: WorksheetSignatureDecision;
  signerName: string;
  /** `null`, ha nincs megjegyzes -- a szerver is igy varja. */
  note: string | null;
}

export type WorksheetSignatureField = "signerName" | "note";

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
 * A HIVATALOS NEV, NEM A BECENEV.
 *
 * Szandekosan NEM a `personDisplayName` helper: az a becenevet reszesiti
 * elonyben, es a sajat fejlecben ki is mondja, hogy a dokumentum mas kerdes --
 * egy alairt munkalapnak azt kell mondania, ki valaki HIVATALOSAN. A becenev a
 * kepernyok koszonoszovegebe valo, nem egy alairas melle.
 */
export function worksheetSignerName(person: WorksheetSignerLike): string {
  return person.displayName.trim();
}

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
  signerName: string,
): WorksheetSignatureResult {
  const name = signerName.trim();

  /**
   * A NEV HIANYA ITT NEM URLAPHIBA, ES EZERT MAS A MONDAT.
   *
   * A mezo zarva van: a szerelo nem tudja "kijavitani", barmit is irunk oda.
   * Egy "add meg a neved" alaku uzenet ilyenkor egy nem letezo gombra
   * mutatna. Amit tehet, az az iroda ertesitese, tehat azt mondjuk meg.
   */
  if (name.length < SIGNER_NAME_MIN)
    return {
      ok: false,
      field: "signerName",
      message:
        "A bejelentkezett felhasználó neve hiányzik vagy túl rövid, ezért a lap nem írható alá. Szólj az irodának, hogy pótolják a nevedet.",
    };
  if (name.length > SIGNER_NAME_MAX)
    return {
      ok: false,
      field: "signerName",
      message: `A bejelentkezett felhasználó neve ${SIGNER_NAME_MAX} karakternél hosszabb, ezért a lap nem írható alá. Szólj az irodának.`,
    };

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

  return {
    ok: true,
    payload: {
      decision: form.decision,
      signerName: name,
      note: note ? note : null,
    },
  };
}
