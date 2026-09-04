/**
 * EGY MUNKALAP-TETEL FELVITELE A HELYSZINEN.
 *
 * === HAROM MEZO, NEM HAT ===
 *
 * A szerelo azt rogziti, MIT csinalt es MENNYIT; az ARAT az iroda adja meg
 * (Balazs dontese, 2026-09-02). Egy ar nelkuli tetellel a lap nem zarhato le,
 * tehat a hiany nem marad eszrevetlen -- egy kotelezo ar viszont azt jelentene,
 * hogy a telefon talalomra kuld egy szamot, es a kezenfekvo nulla a lapon
 * ERTEKKENT allna: aki ranez, nem tudja megkulonboztetni az ingyenes munkatol.
 *
 * === MIERT KULON MODUL ===
 *
 * A kepernyore nincs komponens-teszt ebben az appban. Ami a torzsben marad,
 * azt csak kezzel, telefonon lehet kiprobalni -- es ez az a resz, amit a
 * legdragabb ugy probalni: a helyszinen, munka kozben.
 *
 * === ES 2026-09-04 OTA A TETEL TERERO NELKUL IS ROGZITHETO ===
 *
 * Itt korabban nem allt semmi az offline utrol, mert nem volt: a tetel csak
 * halozattal ment fel. A pinceben allo szerelo szamara ez azt jelentette, hogy
 * a lapot meg tudta nyitni (az mar sorba allt), a MUNKAT viszont nem tudta
 * ravezetni -- vagyis a felvitel fele mukodott.
 *
 * A sorba tett tetel torzse itt all (`QueuedWorksheetLine`), es az azonositoja
 * SZANDEKOSAN NINCS BENNE: azt a sor sajat kulcsa hordozza. Ket helyen tarolva
 * a ketto elcsuszhatna, es akkor az idempotencia-kulcs mast mondana, mint amit
 * a szerver a sorra ir.
 */

import type { QueueWriteOutcome } from "../offline/save-or-queue";

export interface WorksheetLineForm {
  description: string;
  /** Szovegkent, ahogy a felhasznalo beirja: vesszovel vagy ponttal. */
  quantity: string;
  unit: string;
}

export interface WorksheetLinePayload {
  /** A KLIENS adja, es ez idempotencia-kulcs, nem kenyelem -- lasd lent. */
  id: string;
  description: string;
  quantity: number;
  unit: string;
}

export type WorksheetLineField = "description" | "quantity" | "unit";

export type WorksheetLineResult =
  | { ok: true; payload: WorksheetLinePayload }
  | { ok: false; field: WorksheetLineField; message: string };

const DESCRIPTION_MAX = 500;
const UNIT_MAX = 20;

/**
 * A MENNYISEG MAGYAR ALAKBAN IS ERKEZHET.
 *
 * A telefon billentyuzete VESSZOT ad tizedesjelnek, a szerver `number`-t var.
 * Egy szigoru olvasas itt azt jelentene, hogy a szerelo beir "1,5"-ot, es a
 * mentes elhasal egy olyan hibaval, ami a SZAMROL szol -- holott az irasmod a
 * baj. A megengedo olvasas NEM a szigor feladasa: ami nem szam, azt tovabbra
 * is elutasitjuk.
 */
export function parseQuantity(
  value: string,
): { ok: true; value: number } | { ok: false } {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return { ok: false };
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { ok: false };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return { ok: false };
  return { ok: true, value: parsed };
}

/**
 * A SOR AZONOSITOJA A KLIENSTOL JON, ES EZT A SZERVER IS IGY VARJA.
 *
 * A `CreateWorksheetLineDto` kommentje mondja ki, miert: a helyszini rogzites
 * sorba all, es egy megszakadt kuldest a telefon ujrakuld. Szerver-oldali
 * azonosito mellett az ujrakuldes MASODIK sort hozna letre -- a szerelo pedig
 * azt latna, hogy mindent ketszer rogzitett.
 *
 * AZ ALAK A SZERVERE: 8-64 karakter, betu, szam, kotojel es alahuzas. Ezert
 * NEM hasznalhatjuk ugyanazt a `muvelet:kulcs:idopont` alakot, mint a
 * rogzitesnel -- ott kettospont es pont is van benne.
 */
export function worksheetLineId(input: {
  now: number;
  random: number;
}): string {
  const veletlen = Math.floor(input.random * 1_000_000_000)
    .toString(36)
    .padStart(6, "0");
  return `line-${input.now.toString(36)}-${veletlen}`;
}

export function buildWorksheetLinePayload(
  form: WorksheetLineForm,
  id: string,
): WorksheetLineResult {
  const description = form.description.trim();
  if (!description)
    return {
      ok: false,
      field: "description",
      message: "Írd le, mit csináltál.",
    };
  if (description.length > DESCRIPTION_MAX)
    return {
      ok: false,
      field: "description",
      message: `A megnevezés legfeljebb ${DESCRIPTION_MAX} karakter lehet, most ${description.length}.`,
    };

  const quantity = parseQuantity(form.quantity);
  if (!quantity.ok)
    return {
      ok: false,
      field: "quantity",
      message: "A mennyiség szám legyen (például 1,5).",
    };

  const unit = form.unit.trim();
  if (!unit)
    return {
      ok: false,
      field: "unit",
      message: "Add meg az egységet (például óra, db, km).",
    };
  if (unit.length > UNIT_MAX)
    return {
      ok: false,
      field: "unit",
      message: `Az egység legfeljebb ${UNIT_MAX} karakter lehet.`,
    };

  return {
    ok: true,
    payload: { id, description, quantity: quantity.value, unit },
  };
}

/**
 * A SORBA TETT TETEL TORZSE -- AZONOSITO NELKUL.
 *
 * A tetel azonositoja a SOR kulcsa (`sync_queue.id`), es a kuldes onnan veszi
 * (`use-queue-drain.ts`). Ha itt is szerepelne, ket helyen allna ugyanaz, es
 * egy javitas az egyiket atirhatna -- a szerver pedig MAS azonositot kapna,
 * mint amivel a sor magat azonositja. Az idempotencia epp ezen az egyezesen
 * all: ugyanaz a kulcs ujrakuldve nem hoz letre masodik tetelt.
 */
export type QueuedWorksheetLine = Omit<WorksheetLinePayload, "id">;

/**
 * A SOR PAYLOADJA TETELKENT, vagy `null`, ha nem az.
 *
 * NEM egy sima `JSON.parse` cast: egy serult vagy MAS FAJTAJU sor igy nem
 * ertelmes tetelnek latszana, hanem `undefined` mezokkel menne fel a szerverre
 * -- es a hiba a szerveren jelenne meg, ertelmetlen elutasitaskent. Ugyanaz az
 * alak, mint a `readPhotoPayload`.
 */
export function readQueuedWorksheetLine(
  json: string,
): QueuedWorksheetLine | null {
  try {
    const p = JSON.parse(json) as Partial<QueuedWorksheetLine>;
    return typeof p.description === "string" &&
      typeof p.quantity === "number" &&
      typeof p.unit === "string"
      ? { description: p.description, quantity: p.quantity, unit: p.unit }
      : null;
  } catch {
    return null;
  }
}

/**
 * A SORBA TETEL EREDMENYE, EMBERI ALAKBAN -- A TETELRE SZABVA.
 *
 * A dontes kozos (`offline/save-or-queue.ts`), a SZOVEG nem lehet az. A
 * munkalapnal a kovetkezo lepes az, hogy a lap adatlapja meg nem letezik; ITT
 * a lap LATSZIK, es a tetel megsem jelenik meg rajta. Ezt ki KELL mondani:
 * enelkul a szerelo azt hiszi, hogy a mentes nem tortent meg, es ujra beirja
 * -- ket tetel lesz belole, ket kulon kulccsal, es a duplikacio-vedelem sem
 * fogja meg, mert ket kulon felvitel.
 */
export function describeWorksheetLineQueueWrite(
  result: { ok: true; operationId: string } | { ok: false; error: string },
): QueueWriteOutcome {
  if (result.ok)
    return {
      type: "queued",
      operationId: result.operationId,
      message:
        "A tétel a telefonon vár feltöltésre, és amint van térerő, magától felmegy. " +
        "A lapon addig NEM látszik: ne írd be újra, mert akkor kétszer kerül rá.",
    };
  return {
    type: "queue-failed",
    message:
      `A tételt NEM sikerült elmenteni a telefonra (${result.error}). ` +
      "Ez a tétel elveszett: írd be újra, és ha ismétlődik, szólj.",
  };
}

/**
 * HANY TETEL VAR MEG FELTOLTESRE EHHEZ A LAPHOZ.
 *
 * === MIERT KELL, ES MIERT EZ A SZAM A DRAGABB HIANY ===
 *
 * A sorba tett tetel a lap tetel-listajan NEM jelenik meg (a lista a szerver
 * valaszabol jon). A mentes utani mondat ezt kimondja, de az a mondat egyetlen
 * kepernyo-eletre szol: aki visszalep es ujra megnyitja a lapot, MAR SEMMIT
 * nem lat belole.
 *
 * Ez pontosan az a nema alak, amit a hatraleknal mar egyszer megmertunk: a
 * lista ugy nez ki, mintha nem tortent volna semmi. A szerelo pedig nem
 * panaszkodni fog, hanem UJRA beirja a tetelt.
 *
 * `null`, ha nincs ilyen sor -- olyankor a keperno marad csendben.
 */
export function describeQueuedWorksheetLines(count: number): string | null {
  if (count <= 0) return null;
  const mennyi = count === 1 ? "Egy tétel" : `${count} tétel`;
  return (
    `${mennyi} még nem ment fel erről a lapról, ezért itt nem látszik. ` +
    "Amint van térerő, magától felmegy; addig a Feltöltésre várók között találod meg."
  );
}
