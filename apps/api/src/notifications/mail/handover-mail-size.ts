/**
 * A CSATOLMANY MERET-KAPUJA.
 *
 * === A DONTES, ES AMIN ALL (acrobot, 2026-09-21 23:11) ===
 *
 * A csomag CSATOLMANYKENT megy, az egyszeru `messages/send` vegponton -- nem
 * linkkent, es nem a resumable `/upload/` uton. Az indok MERES, nem ervelés:
 *
 *     munkalap PDF a tarban       2 db, max 14 349 bajt
 *     jegy-csatolmany belyegkep   2 db, max 58 553 bajt
 *     a legnagyobb jegy osszege   58 553 bajt (HJ-2026-009)
 *
 * (eles adatbazis, 2026-09-21 23:2x, acrobot merese)
 *
 * Vagyis a mai legnagyobb csomag SZAZ KILOBAJT nagysagrendu. A base64
 * egyharmados novekedesevel is a dokumentalt 5 MB-os hatar harom szazaleka.
 * Egy resumable feltoltes ma nem valtana ki semmit, es onnantol karban kellene
 * tartani.
 *
 * === ES AMIT EZ NYITVA HAGY, KIMONDVA ===
 *
 * Ha valaha egy tobb fenykepes jegy a hatar fele megy, az `/upload/` ut ujra
 * kerdes lesz -- de akkor MERT szammal. A dokumentalt 5 es 35 MB-os hatart mi
 * NEM mertuk meg: az tudas, nem meres, es igy is kell hivatkozni ra.
 */

/**
 * A HATAR KONFIGURACIOBOL JON, NEM BEEGETVE.
 *
 * Az alapertelmezes NEGY MEGABAJT: a dokumentalt 5 MB-os hatar alatt marad
 * annyival, hogy a level SAJAT resze (targy, torzs, fejlecek) is elferjen
 * mellette. A mai legnagyobb csomag ennek a szazad resze -- a szam tehat NEM
 * a mai adathoz van szabva, hanem a vegponthoz.
 *
 * MIERT SZAMIT, HOGY EZ ALLITHATO: ha egyszer egy jegy a hatar fele megy, a
 * valasz nem az lesz, hogy kiadunk egy uj verziot, hanem hogy atallitjuk az
 * erteket -- es kozben eldontjuk, kell-e az `/upload/` ut.
 */
export const HANDOVER_MAIL_MAX_ATTACHMENT_BYTES_DEFAULT = 4 * 1024 * 1024;

export function handoverMailMaxAttachmentBytes(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const nyers = environment.HANDOVER_MAIL_MAX_ATTACHMENT_BYTES?.trim();
  if (!nyers) return HANDOVER_MAIL_MAX_ATTACHMENT_BYTES_DEFAULT;
  /*
    CSUPA SZAMJEGY, VAGY SEMMI -- ES EZT A SAJAT ALLITASOM FOGTA MEG.

    Az elso valtozatom `Number.parseInt`-et hasznalt, ami az ELSO nem-szamjegy
    karakternel megall: a `"4MB"` ertekbol NEGY lett. Az veges es pozitiv,
    tehat minden ellenorzesen atment volna -- es a hatar NEGY BAJT-ra allt
    volna, ami MINDEN csomagot megtagad.
    A hiba iranya szerencses (hangos, nem nema), de a tunete megtevesztő: a
    kuldes ugy allt volna le, mintha minden csomag tul nagy lenne.
  */
  if (!/^\d+$/.test(nyers)) return HANDOVER_MAIL_MAX_ATTACHMENT_BYTES_DEFAULT;
  const szam = Number.parseInt(nyers, 10);
  /*
    EGY ERTELMEZHETETLEN ERTEK NEM LEHET "KORLATLAN".
    Egy elgepelt kornyezeti valtozotol a kapu NEM nyilhat ki: ilyenkor az
    alapertelmezes all vissza, nem a `NaN`, ami minden osszehasonlitason
    atengedne a csomagot.
  */
  return Number.isFinite(szam) && szam > 0
    ? szam
    : HANDOVER_MAIL_MAX_ATTACHMENT_BYTES_DEFAULT;
}

/**
 * A BASE64 UTANI MERET -- ezen all a kapu, nem a nyers bajthosszon.
 *
 * acrobot elso kikotese. A Gmail a NYERS levelet base64url alakban keri, tehat
 * a hataron az a szam szamit, ami tenylegesen atmegy a droton. A ket ertek
 * kozott kb. egyharmad a kulonbseg: egy 4 MB-os nyers csomag 5,3 MB-kent megy
 * ki. Ha a kapu a nyers hosszt nezne, epp a hatar korul engedne at olyat,
 * ami a masik oldalon mar tul nagy.
 */
export function base64Meret(bajtok: number): number {
  return Math.ceil(bajtok / 3) * 4;
}

export type HandoverAttachmentVerdict =
  | { readonly kind: "ok" }
  | {
      readonly kind: "too-large";
      readonly bytes: number;
      readonly limit: number;
      readonly message: string;
    };

/**
 * HATAR FELETT A KULDES MEGTAGADVA -- NEM CSONKITVA.
 *
 * acrobot harmadik kikotese, es ez a lenyeg: egy csonka csomag pontosan az a
 * nema hallgatas, amit Balazs 2026-09-18-an megrott. A vevo kapna egy levelet,
 * ami teljesnek latszik, es hianyozna belole egy munkalap -- errol sem o, sem
 * mi nem tudnank.
 *
 * A HIBAUZENET MEGMONDJA A MERETET ES A JARHATO UTAT. Enelkul a kezelo annyit
 * latna, hogy "nem ment ki", es nem tudna, mit tegyen: a letoltes (#860) ma is
 * mukodik, tehat a csomag ATADHATO, csak nem ezen az uton.
 */
export function handoverAttachmentVerdict(input: {
  bytes: number;
  limit: number;
}): HandoverAttachmentVerdict {
  const kodolt = base64Meret(input.bytes);
  if (kodolt <= input.limit) return { kind: "ok" };
  return {
    kind: "too-large",
    bytes: kodolt,
    limit: input.limit,
    message:
      `A csomag mérete ${Math.round(kodolt / 1024)} KB, ami meghaladja a ` +
      `levélben küldhető ${Math.round(input.limit / 1024)} KB-ot. ` +
      `A hibajegy csomagja letöltéssel átadható.`,
  };
}
