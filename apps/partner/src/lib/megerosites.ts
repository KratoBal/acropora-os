/**
 * AZ ÚJ JELSZÓ ÉS AZ ÚJ ALÁÍRÓKÓD KÉTSZER (kártya e0980428; Balázs, 2026-11-25 13:05 UTC, OS szál: „a partner portalon a
 * felhasznalonal a jelszo es alairokod modositasanal szerintem jo lenne ha ketszer kernenk el az ujakat"). Az új érték alatt egy
 * megerősítő mező áll; amíg a kettő nem egyezik, a mentés gomb nem enged, és a megerősítő mező alatt a hiba mondata áll.
 *
 * A szerver ezt nem kapja meg: a `/account/password` és a `/account/signing-code` szerződése változatlan (az OS felülete is ezt
 * hívja), a megerősítés a gépelési hibát fogja meg a portálon, mielőtt a kérés elmegy.
 */
export type MegerositesFajta = "jelszo" | "alairokod";

const NEM_EGYEZIK: Record<MegerositesFajta, string> = {
  jelszo: "A két jelszó nem egyezik.",
  alairokod: "A két aláírókód nem egyezik.",
};

/** A megerősítő mező hibája; üres megerősítésnél még nincs (a gomb akkor is tiltva marad). */
export function megerositesHiba(
  fajta: MegerositesFajta,
  uj: string,
  megerosites: string,
): string | null {
  if (megerosites === "" || megerosites === uj) return null;
  return NEM_EGYEZIK[fajta];
}

/** Egyezik-e: a mentés feltétele (üres megerősítés nem egyezés). */
export const megerositesEgyezik = (uj: string, megerosites: string) =>
  megerosites !== "" && megerosites === uj;
