/**
 * A CSATOLMANY FELIRATANAK EGYETLEN SZABALYA.
 *
 * Balazs kerese (2026-09-17): a fenykephez lehessen megjegyzest irni, akar mar
 * a feltoltesnel is.
 *
 * KOZOS MODUL, ES NEM KENYELEMBOL. A felirat HAROM gazdan all (hibajegy,
 * munkalap, eszkoz), es a harom dokumentum-tabla alakja SZANDEKOSAN azonos --
 * a sema fejlece ki is mondja, miert. Harom masolat ugyanerre a harom szabalyra
 * azt jelentene, hogy minden kesobbi valtozast haromszor kell megcsinalni, es a
 * harmadik mindig lemarad.
 */

/**
 * A FELIRAT FELSO HATARA. UGYANAZ A SZAM, ami a semaban all
 * (`@db.VarChar(500)`), es ez NEM veletlen egyezes: enelkul egy 501 karakteres
 * szoveg nem a validacion bukna el (ertheto uzenettel), hanem az adatbazison --
 * a hivo 500-at kapna arrol, hogy tul hosszut irt.
 */
export const DOCUMENT_CAPTION_MAX_LENGTH = 500;

/**
 * A HIANY EGYFELE ALAKBAN ALL: `null`.
 *
 * A csupa szokoz UGYANAZ, MINT A SEMMI. Egy szokozokbol allo felirat kitoltott
 * mezonek latszik a listaban, es egy ures sort vinne a galeriaba -- ugyanaz a
 * megfontolas, mint a hibajegy lepteteseneel a megjegyzesnel.
 *
 * ES EZ A SZERKESZTESRE IS ALL, nem csak a feltoltesre: aki kitorli a
 * feliratot es ment, az a HIANYT szanja, nem egy ures stringet. Ha a ket alak
 * mindketto elofordulhatna, a "nincs felirat" es a "szandekosan ures felirat"
 * megkulonboztethetetlen lenne -- es senki nem tudna megmondani, melyiket
 * jelenti.
 */
export function normalizeDocumentCaption(
  caption: string | null | undefined,
): string | null {
  const trimmed = caption?.trim();
  return trimmed ? trimmed : null;
}
