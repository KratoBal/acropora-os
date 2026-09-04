/**
 * A MUNKANAPLO-BEJEGYZES A HELYSZINEN.
 *
 * Balazs kerese, 2026-09-03: a szerelo szabadszavasan beirja, mit csinalt, es a
 * rendszer eltarolja, KI irta es MIKOR.
 *
 * === MIERT KULON MODUL ===
 *
 * A kepernyore nincs komponens-teszt ebben az appban. Ami a torzsben marad, azt
 * csak kezzel, telefonon lehet kiprobalni -- egy bejegyzesnel a helyszinen,
 * munka kozben, ahol a javitas a legdragabb.
 *
 * A tipusok SAJAT, szerkezeti alakok: ez a fajl a teszt-forditasba is bekerul,
 * az pedig nem ismeri az `@/` aliast.
 */

/** A szerver hatara, egy helyen. Ha ott valtozik, itt is valtoznia kell. */
const BODY_MAX = 4000;

export interface WorksheetEntryFormResult {
  ok: boolean;
  /** A levagott szoveg, ha rendben van. */
  body: string;
  /** Amit a szerelonek mondunk, ha nincs. `null`, ha rendben. */
  message: string | null;
}

/**
 * A LEVAGOTT HOSSZ SZAMIT, NEM A BEGEPELT.
 *
 * A csupa szokozbol allo bejegyzes pontosan annyit mond, mint a hianyzo --
 * viszont sort foglalna a listan, szerzot es idopontot kapna, es ugy nezne ki,
 * mintha valaki dolgozott volna. A szerver ugyanigy szur (`MinLength(1)` a
 * levagott szovegen), tehat egy itt atengedett ures bejegyzes ott bukna el, es
 * a szerelo egy technikai hibauzenetet latna a sajat ures mezoje helyett.
 */
export function buildWorksheetEntry(input: string): WorksheetEntryFormResult {
  const body = input.trim();
  if (!body) return { ok: false, body, message: "Írd le, mit csináltál." };
  if (body.length > BODY_MAX)
    return {
      ok: false,
      body,
      message: `A bejegyzés legfeljebb ${BODY_MAX} karakter lehet, most ${body.length}.`,
    };
  return { ok: true, body, message: null };
}

/** Amennyit egy bejegyzesbol ez a modul olvas. */
export interface WorksheetEntryLike {
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * KI ES MIKOR -- EGY SORBAN, A LISTA ALA.
 *
 * === AZ ISMERETLEN SZERZO KIMONDVA, NEM ELREJTVE ===
 *
 * A szerzo azonositoja a szerveren `SetNull` a felhasznalo torlesekor: a
 * bejegyzes megmarad, a nev nelkul. Egy ures hely a nev helyen ugy nez ki, mint
 * betoltesi hiba; egy kihagyott sor pedig azt allitana, hogy a bejegyzes nem is
 * letezik.
 *
 * === ES HA ATIRTAK, AZ IS LATSZIK ===
 *
 * A `updatedAt` a keletkezessel EGYENLO, amig senki nem nyult hozza. Ha
 * kesobbi, azt ki kell mondani: egy szerkesztett bejegyzes ugyanugy nez ki,
 * mint az eredeti, es aki a lapot olvassa, nem tudja megkulonboztetni.
 */
export function worksheetEntryByline(
  entry: WorksheetEntryLike,
  formatDate: (iso: string) => string,
): string {
  const ki = entry.authorName ?? "Ismeretlen szerző";
  const mikor = formatDate(entry.createdAt);
  const atirva =
    entry.updatedAt !== entry.createdAt
      ? `, szerkesztve ${formatDate(entry.updatedAt)}`
      : "";
  return `${ki} · ${mikor}${atirva}`;
}

/**
 * A LISTA URES ALLAPOTA -- ES MIERT NEM UGYANAZ A KET ESET.
 *
 * Egy lapon, amin MEG NINCS bejegyzes, a mondat biztatas: van hova irni. Egy
 * lapon, amit a kero NEM szerkeszthet, a mondat MAS: ott a hianyzo gomb
 * magyarazatra szorul, kulonben ugy nez ki, mint hiba a programban.
 */
export function describeEmptyEntries(canWrite: boolean): string {
  return canWrite
    ? "Ezen a lapon még nincs bejegyzés. Írd le, mit csináltál."
    : "Ezen a lapon még nincs bejegyzés.";
}
