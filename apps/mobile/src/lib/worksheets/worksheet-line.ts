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
 */

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
