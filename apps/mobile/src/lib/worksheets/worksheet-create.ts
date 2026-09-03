/**
 * AZ ÚJ MUNKALAP űrlap logikája, a képernyőtől külön.
 *
 * === MIÉRT KÜLÖN MODUL ===
 *
 * Az appban nincs komponens-teszt: ami a képernyő törzsében marad, azt csak
 * kézzel, telefonon lehet kipróbálni. Ugyanaz a megfontolás, mint az
 * `assets/asset-create.ts`-nél, és ugyanaz a mért hiba mögötte: egy űrlap, ami
 * a szervernek nem megfelelő alakot küld, a felhasználónak úgy néz ki, mintha
 * a gomb nem csinálna semmit.
 *
 * === AMIT A SZERVER KÖVETEL, ÉS AMIT NEM ===
 *
 * A `CreateWorksheetDto` HÁROM mezőt kér: `customerId`, `departmentId` és
 * `subject` (legfeljebb 500 karakter). Minden más elhagyható -- a `lines`
 * mező alapértelmezése ÜRES TÖMB, tehát a munkalap tétel nélkül is létrejön.
 *
 * EZ NEM RÉSZLETKÉRDÉS: emiatt fér el a helyszíni felvitel EGYETLEN
 * képernyőn. A tétel-szerkesztő külön szelet lehet, és amíg nincs meg, a
 * szerelő attól még tud lapot nyitni a helyszínen.
 *
 * A DÁTUMOK SZÁNDÉKOSAN NEM SZEREPELNEK az űrlapon: a kiállítás, a teljesítés
 * és a fizetési határidő az irodai oldalon dől el, ahogy az ár is (Balázs
 * döntése, 2026-09-02). Egy telefonon kitöltött dátum ott ÉRTÉKKÉNT állna, és
 * senki nem tudná megkülönböztetni a szándékostól.
 */

import type { QueueWriteOutcome } from "../offline/save-or-queue";

export interface WorksheetCreateForm {
  /** A munkalap partnere. A választó a `customerId` mezőt adja, nem a partnerét. */
  customerId: string;
  /** A partner helyszíne (alegység). A szerver KÖTELEZŐVÉ teszi. */
  departmentId: string;
  subject: string;
  /** Elhagyható; a szerver 4000 karakterig fogadja. */
  description: string;
}

export interface WorksheetCreatePayload {
  customerId: string;
  departmentId: string;
  subject: string;
  description?: string;
}

/** Melyik mezőnél kell a hibát megmutatni. */
export type WorksheetCreateField = "customer" | "department" | "subject";

export type WorksheetCreateResult =
  | { ok: true; payload: WorksheetCreatePayload }
  | { ok: false; field: WorksheetCreateField; message: string };

/** A szerver határai, egy helyen. Ha ott változnak, itt is változniuk kell. */
const SUBJECT_MAX = 500;
const DESCRIPTION_MAX = 4000;

/**
 * A HIBÁK SORRENDJE A MEZŐK SORRENDJE, és ez nem esztétika: a képernyő a hibát
 * a mezőnél mutatja meg, tehát a legelső hiányzó mező hibáját érdemes adni --
 * különben a felhasználó a lap aljára görget egy olyan üzenetért, ami a tetején
 * lévő üres mezőről szól.
 */
export function buildWorksheetCreatePayload(
  form: WorksheetCreateForm,
): WorksheetCreateResult {
  if (!form.customerId.trim())
    return {
      ok: false,
      field: "customer",
      message: "Válassz partnert a munkalaphoz.",
    };

  if (!form.departmentId.trim())
    return {
      ok: false,
      field: "department",
      message: "Válassz helyszínt: a munkalap ehhez az alegységhez tartozik.",
    };

  const subject = form.subject.trim();
  if (!subject)
    return {
      ok: false,
      field: "subject",
      message: "A tárgy megadása kötelező (mi a munka).",
    };
  if (subject.length > SUBJECT_MAX)
    return {
      ok: false,
      field: "subject",
      message: `A tárgy legfeljebb ${SUBJECT_MAX} karakter lehet, most ${subject.length}.`,
    };

  const description = form.description.trim();
  if (description.length > DESCRIPTION_MAX)
    return {
      ok: false,
      /**
       * A LEÍRÁS HIBÁJA A TÁRGY MEZŐNÉL JELENIK MEG, mert a képernyőn a két
       * mező egymás alatt áll, és a hosszúság az EGYETLEN, amiben a leírás
       * elbukhat. Külön mező-kulcs nélkül a hiba a lap tetején jelenne meg,
       * ahonnan a mentés gomb már kigörgött.
       */
      field: "subject",
      message: `A leírás legfeljebb ${DESCRIPTION_MAX} karakter lehet, most ${description.length}.`,
    };

  return {
    ok: true,
    payload: {
      customerId: form.customerId.trim(),
      departmentId: form.departmentId.trim(),
      subject,
      /**
       * ÜRES LEÍRÁS ESETÉN A MEZŐ KI SEM MEGY. Egy üres sztring a szerveren
       * megkülönböztethetetlen lenne a szándékosan üresre írt leírástól, és a
       * lapon egy üres blokként jelenne meg.
       */
      ...(description ? { description } : {}),
    },
  };
}

/**
 * A SORBA TETEL EREDMENYE, EMBERI ALAKBAN -- A MUNKALAPRA SZABVA.
 *
 * A dontes kozos (`offline/save-or-queue.ts`), a SZOVEG viszont nem lehet az:
 * az eszkoznel a mondat a gyorsitotar-ellenorzest is hordozza (hany eszkoz
 * ellen neztuk meg a matricakodot), a munkalapnal nincs mit hordoznia. Egy
 * kozos szoveg itt tobbet allitana, mint amit tudunk.
 *
 * A KET ESET KULON, es ez a lenyeg: a felhasznalo MINDKETTONEL "elkuldte" a
 * lapot. Ha a sorba tetel bukott el, a lap SEHOL nem letezik -- se a
 * szerveren, se a telefonon --, es ha ugyanazt a zold mondatot adnank, a
 * szerelo tovabbmenne.
 */
export function describeWorksheetQueueWrite(
  result: { ok: true; operationId: string } | { ok: false; error: string },
): QueueWriteOutcome {
  if (result.ok)
    return {
      type: "queued",
      operationId: result.operationId,
      message:
        "A munkalap a telefonon vár feltöltésre. Amint van térerő, magától felmegy.",
    };
  return {
    type: "queue-failed",
    message:
      `A munkalapot NEM sikerült elmenteni a telefonra (${result.error}). ` +
      "Ez a lap elveszett: vidd fel újra, és ha ismétlődik, szólj.",
  };
}
