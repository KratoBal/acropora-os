import {
  kindForStoredMimetype,
  type UploadedFileKind,
} from "../service-assets/uploaded-file-type.js";

import { thumbnailable } from "./document-thumbnail.js";

/**
 * A VISSZAMENOLEGES BELYEGKEP-GENERALAS DONTESE -- a bemenet/kimenet nelkul.
 *
 * MIERT KULON MODUL A PARANCSTOL: ez a resz dontes (mely sorokra kell
 * belyegkep, es mit jelent a lefedettseg), a parancs pedig lekerdezes es iras.
 * Osszekeverve a dontes csak eles adatbazissal lenne merheto -- vagyis
 * gyakorlatilag sehogy.
 */

/** Amit a parancs egy sorrol tud, MIELOTT a bajtokhoz hozzanyulna. */
export interface ThumbnailBackfillRow {
  owner: "asset" | "worksheet" | "service-job";
  ownerId: string;
  documentId: string;
  contentType: string;
  sizeBytes: number;
  hasThumbnail: boolean;
}

/** Egy sor, amihez belyegkep kell, a felismert fajtaval egyutt. */
export interface ThumbnailCandidate extends ThumbnailBackfillRow {
  kind: UploadedFileKind;
}

export interface ThumbnailBackfillPlan {
  /** Amihez belyegkep KELL es MA NINCS. */
  candidates: ThumbnailCandidate[];
  /** Kepek, amiknek MAR van belyegkepe. */
  covered: number;
  /**
   * NEM KEP (PDF es minden mas). KULON SZAM, es nem a "lefedett" resze: ezeknek
   * SOHA nem lesz belyegkepuk, tehat egy kozos szam azt allitana, hogy a
   * lefedettseg sosem lehet teljes.
   */
  notImages: number;
  /** A jeloltek EREDETI merete osszesen -- ebbol lesz merheto a nyereseg. */
  candidateBytes: number;
}

/**
 * MELY SOROKHOZ KELL BELYEGKEP.
 *
 * A DONTES A TAROLT TIPUSBOL JON (`kindForStoredMimetype`), nem egy sajat
 * lista alapjan: egy kulon "mi szamit kepnek" felsorolas egyszer elcsuszna
 * attol a tablatol, ami a feltoltest is eldonti.
 */
export function planThumbnailBackfill(
  rows: readonly ThumbnailBackfillRow[],
): ThumbnailBackfillPlan {
  const candidates: ThumbnailCandidate[] = [];
  let covered = 0;
  let notImages = 0;
  let candidateBytes = 0;

  for (const row of rows) {
    const kind = kindForStoredMimetype(row.contentType);
    if (kind === null || !thumbnailable(kind)) {
      notImages += 1;
      continue;
    }
    if (row.hasThumbnail) {
      covered += 1;
      continue;
    }
    candidates.push({ ...row, kind });
    candidateBytes += row.sizeBytes;
  }

  return { candidates, covered, notImages, candidateBytes };
}

/**
 * A LEFEDETTSEG EMBERI ALAKBAN.
 *
 * A NEVEZO ITT NEM AZ OSSZES SOR, HANEM A KEPEK SZAMA. Egy PDF-et beleszamolva
 * a lefedettseg sosem erne el a szazat, es akkor a szam nem mondana meg,
 * mikor vagyunk keszen -- pontosan azt veszitenenk el, amiert merjuk.
 */
export function describeThumbnailCoverage(plan: ThumbnailBackfillPlan): string {
  const kepek = plan.covered + plan.candidates.length;
  if (kepek === 0)
    return `kep-sor: 0 (nincs mit lefedni). Nem kep: ${plan.notImages}`;
  const szazalek = Math.round((plan.covered / kepek) * 100);
  return (
    `kep-sor: ${kepek}, ebbol belyegkeppel: ${plan.covered} (${szazalek}%), ` +
    `hianyzik: ${plan.candidates.length}. Nem kep: ${plan.notImages}`
  );
}

/**
 * A MERT NYERESEG -- ES CSAK AKKOR, HA TENYLEG KESZULT BELYEGKEP.
 *
 * MIERT MERJUK MEG: a becslesem a megiraskor SZINTETIKUS kepeken allt (zajos
 * bemenet, mert a JPEG a zajt rosszul tomoriti), tehat az IDO megbizhato volt,
 * a MERET csak nagysagrendkent. Ez a szam a VALODI fenykepeken keletkezik --
 * es a parancs kiirja, hogy ne kelljen elhinni.
 */
export function describeThumbnailGain(
  eredetiBajt: number,
  belyegBajt: number,
): string {
  if (belyegBajt === 0) return "belyegkep nem keszult, nincs mit merni.";
  const arany = eredetiBajt / belyegBajt;
  return (
    `eredeti: ${eredetiBajt} bajt, belyegkep: ${belyegBajt} bajt ` +
    `(${(100 / arany).toFixed(2)}%, ${arany.toFixed(0)}x kisebb)`
  );
}
